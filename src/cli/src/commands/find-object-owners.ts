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
                            __typename
                            owner {
                                address
                            }
                        }
                        ... on Shared {
                            __typename
                        }
                        ... on Immutable {
                            __typename
                        }
                        ... on Parent {
                            __typename
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

    let hasNextPage = true;
    let cursor: string | null = null;
    const allResults: { id: string; ownerType: string; owner: string | null }[] = [];

    while (hasNextPage && (limit === 0 || allResults.length < limit)) {
        // @ts-expect-error
        const { data, errors } = await graphClient.query({
            query: findObjectOwnersQuery,
            variables: {
                first: RPC_QUERY_MAX_RESULT_LIMIT,
                type,
                after: cursor,
            }
        });

        if (errors) {
            throw new Error(JSON.stringify(errors, null, 2));
        }

        const objects = data?.objects.nodes;
        if (!objects?.length) break;

        for (const obj of objects) {
            if (limit !== 0 && allResults.length >= limit)
                break;

            allResults.push({
                id: obj.address,
                ownerType: obj.owner?.__typename || "unknown",
                owner: getOwnerAddress(obj.owner)
            });
        }

        hasNextPage = data?.objects.pageInfo.hasNextPage ?? false;
        cursor = data?.objects.pageInfo.endCursor ?? null;
    }

    console.log(JSON.stringify(allResults));
}

function getOwnerAddress(owner: any): string | null {
    if (!owner) return null;

    switch (owner.__typename) {
        case "AddressOwner":
            return owner.owner?.address || null;
        case "Parent":
            return owner.parent?.address || null;
        case "Shared":
        case "Immutable":
            return null;
        default:
            return null;
    }
}
