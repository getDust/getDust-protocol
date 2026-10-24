# Dust

**Make idle tokens pay rent.** Covered-call offers on Solana.

[![Live site](https://img.shields.io/badge/live-getdust.fun-fa4423?style=flat-square)](https://getdust.fun)
![Chain](https://img.shields.io/badge/chain-Solana-1d2cc1?style=flat-square)

| | |
|---|---|
| Chain | Solana |
| Contract address | _pending_ |

## Overview

Dust lets a holder freeze a batch of tokens in a program-owned vault, name the exit level at which the batch may leave, and receive a payment up front from a buyer who wants first refusal. If the buyer takes the batch, the holder receives the exit amount. If nobody does, the batch goes home.

This repository holds the public site. It is a static build with no framework and no runtime dependencies.

## Features

- Live Solana market panel: ten busiest boosted tokens by 24h volume, a scrolling strip, count-up numbers, skeleton loading, backoff on failure, polling that pauses while the tab is hidden.
- A register of external facts. Every fact is one record with a state of `stated`, `absent` or `unconfirmed`; anything not stated renders inert and carries no link or value.
- Contract address slot pinned to the top of the page, inert until an address is stated, then click-to-copy.
- Spring-driven reveals, hero parallax, spotlight hover, scroll progress, and a full reduced-motion fallback.
- A gate suite with a mutation harness that proves each rule can fail.

## Links

- Site: https://getdust.fun
- X: https://x.com/getDustFun
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Build

```bash
npm run build   # writes dist/
npm run gates   # build checks plus mutation harness
npm run serve   # local preview of dist/ on port 4173
```

Deploy by uploading the contents of `dist/`.

## Licence

MIT. See [LICENSE](LICENSE).
