---
title: Exactly Protocol April 2024 Findings Review
---

| Description                                                                                                                                                                                                                                              | Tip                                                                                                  | Link                                                                                                     | By             |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|----------------|
| Not prioritizing the lowest LTV asset during liquidation can reduce the overall health of the position.<br><br>More details: [YouTube by @0xOwenThurm](https://www.youtube.com/watch?v=AD2IF8ovE-w&t=1884s)                                                       | -                                                                                                    | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/155)                 | @0xsantiellena |
| Instant fees paid for borrowing are calculated by taking the current debt and TWA assets => can manipulate the rate by repaying and borrowing again                                                                                                       | Check that both values for the rate are TWA                                                          | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/67)                  | @santipu_      |
| Bad debt is either cleared 100% from protocol's earnings or not cleared at all => diff stored vs real balance => last user(s) can't withdraw                                                                                                             | Check cases when only part of bad debt can be cleared                                                | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/66)                  | @santipu_      |
| Liquidation (liqn) revert if collateral (C) available is < reward. Attacker front-runs (FR) liqn, removes C => liqn reverts.<br><br>Trying to liquidate and get collateral from a pool that someone has borrowed everything from.                        | Ensure liqn is always possible. Consider how FR can cause liqn to revert                             | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/70)                  | @santipu_      |
| No check for allowance when borrowing 0 => anyone can force a user to enter a market => undesired collateral is used for the user                                                                                                                        | Ensure spendAllowance includes a check for 0; check 0 value flow                                     | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/76)                  | @bin2chen      |
| When an admin adds rewards before the last batch is fully distributed, unclaimed rewards from the last batch are lost                                                                                                                                     | Check cases when `set` is called before all rewards are claimed                                      | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/95)                  | @DzordanTa1567 |
| Rewards (R) are stored in shares, but paid in their $ cost. Share price always grows => claiming R regularly is more profitable than once at the end                                                                                                      | Store R in the currency used for payment                                                             | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/98)                  | @DzordanTa1567 |
| Dust borrow doesn't accrue fees. Attacker borrows dust multiple times, get a free loan                                                                                                                                                                    | Check if borrowing dust amount reverts or accrues fees; rounding is in favor of the protocol         | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/68)                  | @santipu_      |
| Code: if(assetsInVault == 0){utilization = 0}. Bug: (100% borrowed OR vaultNotUsed) => assets == 0 => minRate used if user deposits + borrows now                                                                                                         | Check deposit+borrow large amount when assets == 0                                                   | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/150)                 | @0xSimao       |
| Desync between vars/logic: some fns do not update all required vars for rate calculation => rate is a little off                                                                                                                                          | Check the diff between similar fns and which vars they change                                        | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/72)                  | @santipu_      |
| Protocol is paused or a pool is inactive => earnings are not accrued => incorrect calculations in some fns                                                                                                                                               | Think about what will happen if fns are not called for a significant amount of time                  | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/158)                 | @0xSimao       |
| Bug: diff logic in alike fns; clearBadDebt doesn't call accrueEarnings => loss of funds in some cases                                                                                                                                                     | Check diff in logic in alike fns, e.g., when both close a position                                   | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/162)                 | @Trungore      |
| While the 1st batch (b1) is being distributed, admin adds more rewards. New rate = (b1+b2)/time, applied to time period [b1Start, now] => undistributed rewards considered distributed                                                                    | Check what happens when calling a fn while the last op triggered by it is ongoing                    | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/245)                 | @0xSimao       |
| When a borrower has several collateral assets and borrow assets, the LTV is averaged. Repayment happens in one market only. The liquidator receives a different value of collateral depending on the market they choose.<br><br>In a low LTV market, they receive more collateral than debt because the collateral is valued higher (averaged with a higher LTV). In a high LTV market, they receive less collateral than debt because the collateral is valued lower (averaged with a lower LTV). This can lead to bad debt or a loss to the liquidator | When you see LTV is averaged, consider the consequences on each collateral liquidation               | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/117)                 | @0xSimao       |
| Incorrect totalAssets calculation during liquidation (does not include accrued interest), which leads to a jump in totalAssets after the liquidation.<br><br>If the attacker has most of the LP, allowing them to withdraw totalAssets, it's possible to have more assets after the liquidation than the deposited + borrowed assets                                              | Virtual (not yet saved to storage) assets are dangerous; make sure they are always counted correctly | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/101)                 | @0xSimao       |
| I was looking for an inflation attack during @exactlyprotocol on @sherlockdefi, but for some reason, I didn't think about depositing, waiting for fee accrual, and withdrawing                                                                             | -                                                                                                    | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/41)                  | @kankodu       |
| Even a small loss of fees can be amplified. Think about WBTC (low decimals and high price) and 20k txs. I would never guess that it could be profitable, given the high gas costs, but it can be a valid M                                                | -                                                                                                    | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/68)                  | @santipu_      |
| Bug: if collateralAsset == borrowAsset and vault.liquidAssets < paymentForLiquidator => can't liquidate                                                                                                                                                   | Check logic when collateral == liability and no liquid funds are left                                | [ref](https://github.com/sherlock-audit/2024-04-interest-rate-model-judging/issues/162)                 | @0xSimao       |