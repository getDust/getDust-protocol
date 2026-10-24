# Dust Whitepaper

## Vision and mission

Most tokens in most wallets do nothing. They sit, they wait, and their holders carry all the risk of waiting. Dust exists to give that resting balance a job.

The mission is simple: let any holder on Solana attach a price and a window to a batch of tokens they already own, and let someone else pay for the right to that price. The holder is paid first. The buyer decides later. A vault, not a counterparty, holds the batch until exactly one settlement happens.

## How it works

1. **Freeze.** A holder moves a batch into a program-owned vault and writes down the exit level, the window and the payment asked.
2. **Match.** A buyer pays the asked payment. It reaches the holder at once and the terms lock.
3. **Take.** Inside the window the buyer may pay the exit level and collect the batch.
4. **Lapse.** If the window closes untaken, anyone may trigger the return and the batch goes home.

Taking and lapsing race for a single settlement. Whichever lands first closes the offer.

## Tokenomics

All values below are placeholders until terms are published.

| Item | Value |
|---|---|
| Token | pending |
| Contract address | pending |
| Total supply | pending |
| Cut on payment | pending |
| Cut on a taken batch | pending |
| Reward pool share | pending |
| Buyback and burn share | pending |
| Operations share | pending |

## Roadmap

**Phase 1: Foundation.** Public site, live market panel, register of confirmed facts, community channel on X.

**Phase 2: Program.** Vault program, offer creation and cancellation, matching, settlement paths, independent review.

**Phase 3: Market.** Offer book, position views, buyer flow, wallet integration.

**Phase 4: Expansion.** More token types, richer window options, tooling for integrators.

## Team

Team details: pending.
