# zui: Sui command line tools

![Polymedia Zui](https://assets.polymedia.app/img/zui/open-graph.webp)

## `zui -h`

```
Usage: zui [options] [command]

zui: Sui command line tools

Options:
  -V, --version       output the version number
  --json              output in JSON format
  -q, --quiet         suppress non-error output
  -v, --verbose       show debug output
  -h, --help          display help for command

Commands:
  bulksend            Airdrop coins to multiple addresses
  bytecode-transform  Modify Move bytecode by replacing constants and identifiers
  bytecode-publish    Publish Move bytecode files as a Sui package
  clock-time          Get the current onchain timestamp in milliseconds
  coin-send           Send a coin amount to an address
  coin-zero-destroy   Destroy all zero-balance coin objects
  coin-zero-send      Create and transfer zero-balance coins
  empty-wallet        Transfer all non-SUI objects to an address
  find-last-tx        Find the latest transaction for one or more Sui addresses
  find-coin-holders   Find coin holders and their balances
  find-nft-holders    Find unique holders of an NFT collection
  find-nfts           Find all NFTs (object ID, owner, and name) in a collection
  find-nft-verified   Find all NFT collections that are verified on TradePort
  find-object-owners  Find objects of a specific type and their owners
  msg-sign            Sign a Sui personal message with your active keypair
  msg-verify          Validate a Sui personal message signature
  publish             Publish all packages in a directory
  rand-addr           Generate pseudorandom Sui addresses
  help                display help for command
```

## Installation

```
npm --global install @polymedia/zui
zui -h
```

If you'll fetch NFT data, set your Indexer.xyz credentials as environment variables:
```
export INDEXER_API_USER=your_username
export INDEXER_API_KEY=your_api_key
```


## Development

```
git clone https://github.com/juzybits/polymedia-zui.git
cd polymedia-zui
cd src/cli
pnpm i
pnpm zui -h
```

Optionally, create a `src/cli/.env` file with your Indexer.xyz credentials.
