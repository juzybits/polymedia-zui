import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphql } from "@mysten/sui/graphql/schemas/latest";

import { RPC_QUERY_MAX_RESULT_LIMIT } from "@polymedia/suitcase-core";

import { debug } from "../logger.js";

type Result = {
    id: string;
    ownerType: string;
    owner: string | null;
};

export async function findObjectOwners({
    type,
    rpc,
    limit,
}: {
    type: string;
    rpc: string;
    limit: number;
}): Promise<void>
{
    const graphClient = new SuiGraphQLClient({
        url: rpc,
    });

    let queryNum = 1;
    let hasNextPage = true;
    let cursor: string | null | undefined = null;
    const results: Result[] = [];

    while (hasNextPage && (limit === 0 || results.length < limit))
    {
        debug(`query ${queryNum++}, cursor: ${cursor}`);
        const resp = await queryObjectOwners(graphClient, type, cursor);

        if (resp.errors) {
            if (resp.errors[0]?.message === "Requested data is outside the available range") {
                break;
            }
            throw new Error(JSON.stringify(resp.errors, null, 2));
        }
        if (!resp.data) {
            throw new Error("Query returned no data");
        }

        const objects = resp.data.objects.nodes;

        for (const obj of objects)
        {
            if (limit !== 0 && results.length >= limit)
                break;

            results.push({
                id: obj.address,
                ownerType: obj.owner?.__typename || "unknown",
                owner: ((owner) => {
                    if (!owner) return null;
                    if (owner.__typename === "AddressOwner")
                        return owner.owner?.address || null;
                    if (owner.__typename === "Parent")
                        return owner.parent?.address || null;
                    return null;
                })(obj.owner)
            });
        }

        hasNextPage = resp.data.objects.pageInfo.hasNextPage;
        cursor = resp.data.objects.pageInfo.endCursor;
    }

    console.log(JSON.stringify(results));
}

async function queryObjectOwners(
    graphClient: SuiGraphQLClient,
    type: string,
    cursor: string | null | undefined,
) {
    const query = graphql(`
        query FindObjectOwners($first: Int!, $type: String!, $after: String) {
            objects(
                first: $first
                after: $after
                filter: {
                    type: $type
                }
            ) {
                nodes {
                    address
                    owner {
                        __typename
                        ... on AddressOwner {
                            owner { address }
                        }
                        ... on Parent {
                            parent { address }
                        }
                    }
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }
    `);

    return await graphClient.query({
        query: query,
        variables: {
        first: RPC_QUERY_MAX_RESULT_LIMIT,
        type,
            after: cursor,
        }
    });
}
