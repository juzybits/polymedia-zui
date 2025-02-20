import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphql } from "@mysten/sui/graphql/schemas/latest";
import { RPC_QUERY_MAX_RESULT_LIMIT } from "@polymedia/suitcase-core";

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

    const findObjectOwnersQuery = graphql(`
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
                        ... on AddressOwner {
                            owner { address }
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

    let hasNextPage = true;
    let cursor: string | null = null;
    const allResults: { id: string; owner: string }[] = [];

    while (hasNextPage && (limit === 0 || allResults.length < limit)) {
        const result: any = await graphClient.query({
            query: findObjectOwnersQuery,
            variables: {
                first: RPC_QUERY_MAX_RESULT_LIMIT,
                type,
                after: cursor,
            }
        });

        const objects = result.data?.objects.nodes;
        const pageInfo = result.data?.objects.pageInfo;

        if (!objects || objects.length === 0) {
            break;
        }

        for (const obj of objects) {
            if (limit !== 0 && allResults.length >= limit) {
                break;
            }
            allResults.push({
                id: obj.address,
                owner: obj.owner?.owner?.address || "no owner"
            });
        }

        hasNextPage = pageInfo?.hasNextPage ?? false;
        cursor = pageInfo?.endCursor ?? null;
    }

    console.log(JSON.stringify(allResults));
}
