## Code walkthrough
- Terms
    - `--` -- comment
    - r -- require
    - U -- underlying
    - m.s -- msg.sender
    - xX -- invalid thought
    - `~` -- by default; or assumed to be, but not necessary true; Most often it means that in the code it is called by some contract, but there is no access control, so it can be called by someone else

- LoanNFT
    - openLoan/openEscrowLoan
        - `_openLoan` -- pull underlying, swap for cash, keep maxLoss on takerNft, mint LoanNft and give unloosable cash to the borrower ^LNft---openLoan
            - -- summary
                - validations
                - pull underlying + escrowFee from borrower
                - (optional) mint escrowNft to funds provider using funds from escrow.offerId (borrower-provided id)
                    - also `escrowNft.offers[id].available -= underlyingAmt
                    - funds stay on LoansNft always, escrow just get a fee, escrow is  probably used just for tax reasons
                - mint CTakerNft to LoansNft, CProviderNft on `.liquidityOffers[ProviderOffer.id].provider`
                    - swap underlying -> cash
                    - keep max loss for taker on CTakerNft contract, from swap money
                    - keep max win for taker on CProviderNft contract, from `CProviderNft.liquidityOffers[ProviderOffer.id]`
                - mint LoansNft to borrower
            - Params
                - underlyingAmount ^LNft---openLoan--underlyingAmount
                    - pulled from borrower(msg.sender) with escrowFee
                    - set as escrowed on [[#^ESNft---startEscrow]]
                    - transfered from LoansNft and immedieately back
                    - on `_swapAndMintCollar` exchanged to cash
                        - maxLoss is kept
                        - everything else is sent to the borrower
                    - stored on LoansNft.loans.underlyingAmount
                    - maybe something else, but only interested in above
            - `require(configHub.canOpenPair(underlying, cashAsset, address(this)), "");` -- is WhiteListed? enumerable set, updated by owner of ConfigHub
            - `escrowFee = usesEscrow ? escrowFee : 0;` -- later, see also [[#^LNft-q1]]
            - `underlying.safeTransferFrom(msg.sender, address(this), underlyingAmount + escrowFee);` -- pull collateral/underlying from msg.sender (borrower)
            - `_conditionalOpenEscrow(usesEscrow, underlyingAmount, escrowOffer, escrowFee);` mint ESNft for escrowSupplier + creates a new escrow; keeps only escrowFee ^LNft---conditionalOpenEscrow
                - -- summary
                    - validations
                    - mint ESNft to ESNft.offer.supplier; starts a new escrow using funds from offer.id or part of it
                    - transfer funds from LoansNft to ESNft, then `escrowed` back to LoansNft. Basically keep only the escrowFee
                - `escrowNFT = offer.escrowNFT;` -- offer is userProvided
                    - `escrowNFT` checked in [[#^LNft---conditionalOpenEscrow--canOpenSingle]] below
                - `require(escrowNFT.asset() == underlying, "");`
                    - EscrowSupplierNFT.asset() is immutable in original contract
                - `require(configHub.canOpenSingle(underlying, address(escrowNFT)), "");` -- make sure whitelisted by configHub.owner ^LNft---conditionalOpenEscrow--canOpenSingle
                - `underlying.forceApprove(address(escrowNFT), escrowed + fee);` -- rewrite approval to a new value; On revert calls .approve(0) and .approve(X) again ^OZ-ERC20-forceApprove
                - `escrowId = escrowNFT.startEscrow({ offerId: offer.id, escrowed: escrowed, fee: fee, loanId: takerNFT.nextPositionId() });`-- mint ESNft to ESNft.offer.supplier; starts a new escrow using funds from offer.id or part of it
                    - ![[#^ESNft-startEscrow]] 
            - `(takerId, providerId, loanAmount) = _swapAndMintCollar(underlyingAmount, providerOffer, swapParams);` --  swap, mint NFTs, arrange funds ^LNFT---swapAndMintCollar
                - -- summary
                    - validations
                    - swap underlying -> cash, validate diff price <=10% from oracle
                    - split cashFromSwap on 
                        - loan -- amount to send to the borrower, == put strike price (the position can't get below it); 
                        - takerLocked -- funds at risk, will be kept on the contract just in case
                    - create paired taker-provider NFTs, provider locks max profit that taker can get from the collar. LoansNFT >-(`takerLocked`)-CTakerNft
                - all params are user-provided
                - `configHub.canOpenPair(underlying, cashAsset, address(takerNFT)`/`providerNFT` -- whitelist check
                    - underlying -- GPT: == collateral
                        - GPT -- [[#What is LoanNFT.underlying?]]
                    - cashAsset -- GPT: == borrowed asset
                        - GPT -- [[#The Cash Asset Used in LoanNFT]]
                        - vs underlying [[#Understanding the Roles of `cashAsset` and `underlying`]]
                    - takerNFT -- borrower
                        - GPT: [[#A Comparative Analysis of TakerNFT and ProviderNFT Contracts]]
                    - providerNFT -- LP
                - underlyingAmount != 0 -- collateral requested to be used by caller (opener/borrower) is not 0. So the position can't have no collateral, at least not on `open`
                - `uint cashFromSwap = _swap(underlying, cashAsset, underlyingAmount, swapParams)` -- swap underlyingAmount to cashAsset using borrower-provided swapper ^LNft---swap
                    - `allowedSwappers[swapParams.swapper]` -- white-listed by owner of LoansNft
                    - `uint balanceBefore = assetOut.balanceOf(address(this));` -- for diff
                        - How come we have a balance here? (for `_swapAndMintCollar`) -- Maybe we don't, just to make sure we use diff and no one force fed the contract
                    - `assetIn.forceApprove(swapParams.swapper, amountIn);` -- 1-3 calls into `assetIn`, [[#^OZ-ERC20-forceApprove]]
                    - ISwapper(swapParams.swapper).swap(
                        - is swapper whiteListed? -- no, anyone
                    - `amountOut == amountOutSwapper` -- both swapper reply and balanceOf diff match
                    - `amountOut >= swapParams.minAmountOut` -- protection against sandwich or just bad exchange rate
                - `_checkSwapPrice(cashFromSwap, underlyingAmount);` -- check the change from oracle <= 10%
                    - ITakerOracle oracle = takerNFT.oracle(); -- request oracle from immutable contract takerNFT. Oracle can be set by takerNFT's owner
                    - `uint underlyingFromCash = oracle.convertToBaseAmount(cashFromSwap, oracle.currentPrice());` -- convert back using oracle
                        - oracle.convertToBaseAmount -- rounds down; quoteTokenAmount x precision / atPrice
                        - oracle.currentPrice -- mostly just latestRoundData, but can be more complex
                            - See [[#^ChainlinkOracle-currentPrice]] and [[#^CombinedOracle-currentPrice]]
                    - `uint absDiff = a > b ? a - b : b - a;` -- absDiff, correct
                    - `uint deviation = absDiff * BIPS_BASE / underlyingAmount; require(deviation <= MAX_SWAP_PRICE_DEVIATION_BIPS,"...")` -- require deviation <= 10%
                        - BIPS -- 10_000
                        - MAX_SWAP_PRICE_DEVIATION_BIPS -- 1000
                        - deviation -- 
                            - basically diff/amount percents, how big is diff comparing to amounts
                            - if 10% 10x10k/100=1k
                            - if 1% 100
                            - 9x10k/90k is the limit
                            - rounds down on ~1BIP = 0.01%
                - comment above ltvPercent -- basically sent some cash to borrower, and keep some on taker
                    - GPT: [[#Understanding Loan Creation A Breakdown of the Code Snippet]]
                    - // split the cash to loanAmount and takerLocked -- cash => loanAmount, takerLocked
                    - // this uses LTV === put strike price, so the loan is the pre-exercised put (sent to user)  in the "Variable Prepaid Forward" (trad-fi) structure. 
                        - Summary: immediately get cash for your collateral, using LTV == cash per collateral == put strike price per collateral
                        - LTV -- loan-to-value == underlying/collateral to cash/borrowed
                        - put strike price -- right to sell underlying for a specific price
                            - for put buyer: the right to sell for a specific price; OOM if the price above, because can sell on the market with more profit
                            - for put writer: the obligation to buy at a specific price
                            - buyer is bearish, writer is bullish
                        - Variable Prepaid Forward -- buy put, to protect against price fall below X; Sell call to get cash now, but loose some upside. E.g. `[85; 220]` collar from Cuban. Can't make more than 220, can't loose more than 85. Also has a date, so not a taxable event (arguably/depends) until settled; Basically `＿/￣` shape
                            - https://docs.collarprotocol.xyz/collar-primer/further-reading/
                                - https://www.investopedia.com/terms/v/variable-prepaid-forward-contracts.asp
                                - https://www.forbes.com/sites/robertwood/2021/05/29/money-now-taxes-later-with-prepaid-forward-contracts/
                                - https://markets.businessinsider.com/news/stocks/how-mark-cuban-saved-billions-yahoo-windfall-dot-com-crash-2020-6-1029303375
                            - [ ] Collar -- 
                                - [ ] ![[Pasted image 20241128115159.png]]
                                - [ ] https://www.investopedia.com/terms/c/collar.asp
                                - [ ] https://optionalpha.com/strategies/collar-strategy pic from here
                        - loan is the pre-exercised put (sent to user) -- sold collateral and got cash
                            - GPT: [[#The Loan as a Pre-Exercised Put Option]]
                            - pre-exercised probably == early exercise
                            - So we exercise the put (right to sell) == sell underlying, get cash
                        - LTV === put strike price -- probably means that if it was a put, it would have for the same X of cash and 1 unit of collateral => X strike price, for 1 unit collateral
                    - The Collar paired position NFTs implement the rest of the payout. -- 2 NFTs: 1 for lender, 1 for borrower, somehow paired
                        -  paired position NFTs -- One for lender, one for borrower
                            - GPT: [[#Paired Position NFTs in the Collar Protocol]]
                - uint ltvPercent = providerNFT.getOffer(offerId).putStrikePercent; -- just read value set by offer creator (LP,/lender)
                    - providerNFT.getOffer(offerId)
                        - created on [[#^CProviderNFT-createOffer]]
                        - updates amounts on `updateOfferAmount` and `mintFromOffer`
                    - .putStrikePercent
                        - Set on [[#^CProviderNFT-createOffer]], putStrikePercent <= MAX_PUT_STRIKE_BIPS
                - `loanAmount = ltvPercent * cashFromSwap / BIPS_BASE; uint takerLocked = cashFromSwap - loanAmount;` -- cash => loanAmount, takerLocked
                - `cashAsset.forceApprove(address(takerNFT), takerLocked);` -- allow `takerNFT` contract to pull cash from LoansNft
                - `(takerId, providerId) = takerNFT.openPairedPosition(takerLocked, providerNFT, offerId);` --   mint CProviderNft, mint CTakerNft, pull `takerLocked` from caller (LoansNft, Rolls) ^CTakerNFT-openPairedPosition
                    - -- summary: 
                        - a lot of validations
                        - mint CProviderNft using offer, pay protocol fees
                        - mint CTakerNft, pull `takerLocked` funds from LoansNft
                    - `takerLocked` -- maxLoss: all U in cash - putStrike (sentToBorrower) ^CTakerNFT-openPairedPosition--takerLocked
                        - -- calculated from LP provider set `putStrikePercent`, up to 100% 
                        - -- locked on borrower, funds received on swap of collateral to cash, some cash sent back as loan
                            - -- `cashFromSwap - loanAmount`, collateral value - sent to borrower
                        - takerLocked = cashFromSwap - loanAmount = cashFromSwap - putStrikePercent x cashFromSwap = cashFromSwap (1 - putStrikePercent)
                            - loanAmount =` ltvPercent * cashFromSwap` -- = putStrikePercent x cashFromSwap
                                - ltvPercent = putStrikePercent
                    - `providerNFT` -- kind of verified by `configHub.canOpenPair(underlying, cashAsset, address(providerNFT))` that whitelisted for this Underlying-CashAsset
                    - `offerId` -- not yet verified
                    - configHub.canOpenPair x 2 -- check again that `this`  and `providerNFT` whitelisted
                    - `require(providerNFT.underlying() == underlying`, `require(providerNFT.cashAsset() == cashAsset` -- verify both assets match
                    - `CollarProviderNFT.LiquidityOffer memory offer = providerNFT.getOffer(offerId); require(offer.duration != 0, "taker: invalid offer"); ` -- verify offer is set (would be 0 otherwise)
                    - `uint providerLocked = calculateProviderLocked(takerLocked, offer.putStrikePercent, offer.callStrikePercent);`  -- callStrike - spot; max profit for taker, will probably be paid by provider ^CTakerNFT-openPairedPosition--providerLocked
                        - -- I think the main idea is if the price goes up to the moon taker can win up to `callStrike - spot`, and someone needs to pay them. It will be provider
                        - taker -- borrower
                        - GPT: [[#Breaking Down `calculateProviderLocked` Function]]
                        - Good to understand https://docs.collarprotocol.xyz/collar-primer/example-trade/, point 2, $200 collateral
                        - uint putRange = BIPS_BASE - putStrikePercent; -- how much price is allowed to fall, in bps, {1pbs; 1x); taker: max loss; LP: drop before loss
                            - -- How much max the taker can loose from current price, percents
                            - -- How much the price can change until LP will start to loose money
                            - 100% - X%, X is strictly < 10_000 on [[#^CProviderNFT-createOffer]] 
                                - putStrikePercent <= MAX_PUT_STRIKE_BIPS; MAX_PUT_STRIKE_BIPS = BIPS_BASE - 1;
                            - putStrikePercent -- set on the LP offer by creator
                        - uint callRange = callStrikePercent - BIPS_BASE; -- how much price is allowed to grow, in bps, {1bps;9x}; taker: max win; LP: rise before gain
                            - -- How much max the taker can win from current price, percents
                            - -- How much the price can change up until LP will start to gain profit
                            - callStrikePercent -- set on the LP offer by creator
                            - Maybe how much the price can rise above the current price
                            - X% - 100%
                            - X ∈ {10_001; 100_000} => diff ∈ {1bps; 9x}
                        - `takerLocked * callRange / putRange`  -- amt x (callStrike - spot)
                            - -- rise before gain in collateral/underlying amount = diff between spot and call strike = callStrike - spotPrice
                            - -- the higher the callStrike the more collateral is required
                            - [[#^CTakerNFT-openPairedPosition--takerLocked]] -- cashFromSwap x (1 - putStrikePercent)
                            - cashFromSwap x (1 - putStrikePercent) x callRange / (1 - putStrikePercent) = cashFromSwap x callRange = amt x spotPrice x riseBeforeGain = amt x  rise before gain in collateral(=underlying) amount
                            - cashFromSwap x (callStrikePercent - 1) = spot x callStrikeIn% - spot = callStrike - spot = maxProfit (for taker)
                            - `callRange / putRange` --  grow until profit / drop until loss
                                -  {1bps; 9x} / {1pbs; 1x)
                                - Examples call/put
                                    - range: 9x/~1x; %: 1000%/0.01%
                                        - spot $1k
                                        - call $10k
                                        - put $1k
                                        - providerLocked ~9x of taker
                                        - takerAmount 1bps of strike
                                    - 0.1x/0.1x; %: 110%/90%
                                        - spot $1k
                                        - call $1.1k
                                        - put $0.9k
                                        - provider locked 1x of taker
                                        - takerAmount 90% of strike
                                    - 2.1x/0.7x; %: 310%/30%
                                        - spot $1k
                                        - call $3.1k
                                        - put $0.7k
                                        - provider locked 3x of taker
                                        - takerAmount 30% of strike
                            - 
                        - Thoughts
                            - To issue the collar option LP need to have collateral. What is the max loss? -- `-$1000` or the put price
                                - Call for writer -- obligation to sell for strike price, bearish, hope the price will go below strike, so no one will execute the call
                                - Call for buyer -- right to buy at strike price, bullish, will be able to buy below market
                                - Put for writer -- obligation to buy for strike, bullish, hope the price will go above strike, and no one wants to sell for cheap put strike
                                - Put for buyer -- right to sell at strike, bearish, will be able to sell above market
                                - Who is writer, who is buyer here? -- taker: buy put, write calll; LP: write put, buy call
                                    - Collar strategy: buy put, sell call; For taker
                                    - Taker: buys put, sells call
                                        - Has a right to buy at put strike, has obligation to sell at call strike
                                        - Collateral required for 1 unit
                                            - put (right to sell) $1000
                                            - call (obligation to sell) $1100
                                            - Got cash from selling call
                                            - bearish case: 
                                                - price drops to $0, 
                                                - call OTM -- no customers for taker: why buy for $1.1k if can get for free on the market
                                                - put ITM -- taker executes: why sell for free if can get $1k
                                                - buys on the market for $0, sells for $1000; 
                                                - OR sells their collateral for $1000; otherwise would loose all
                                                - Balance: $1000
                                            - bullish case: 
                                                - price goes to $2000, 
                                                - call ITM -- everyone wants to buy for $1.1k, market is so high
                                                - put OTM -- taker ignores: why sell for $1k if can sell for $2k
                                                - Balance: $1100
                                            - best case(bear): $1000; 
                                            - worst case(bull): -$100
                                            - and also has a collateral that looses current price on bear, and unlimited upside on bull
                                        - Let's now check not just a collar, but collar + collateral
                                            - bear, price drops to $0
                                                - put +$1000;
                                                - call $0;
                                                - result: +$1000
                                            - bull, price up to $2k
                                                - put $0
                                                - call +$1100
                                                - result +$1100
                                                - Note: would be +$2k if no call, but needed cash
                                    - Maker/LP: sells put, buys call
                                        - Collateral required for 1 unit
                                            - put (obligation to buy) $1000
                                            - call (right to buy) $1100
                                            - Got cash from selling put
                                            - bearish case: 
                                                - price drops to 0, 
                                                - call OTM, -- $0 
                                                - put ITM,  -- -$1000
                                                - looses $1000
                                            - bullish case: 
                                                - price goes to $2000
                                                - call ITM, -- +$900, but unlimited upside
                                                - put OTM, -- $0
                                                - unlimited profit
                            - Why putStrikePercent = ltvPercent?
                                - GPT: [[#Put Strike Percent as Loan-to-Value (LTV)]]
                                - Design choice. So basically put is a guaranteed profit. We can give it instantly. That's our Value in LTV
                        - providerLocked usage
                            - in [[#^CProviderNFT-settlePosition]]
                            - in [[#^CProviderNFT-cancelAndWithdraw]]
                            - in [[#^CProviderNFT-mintFromOffer]]
                            - in [[#^Rolls]]
                    - uint startPrice = currentOraclePrice();
                    - `(uint putStrikePrice, uint callStrikePrice) = _strikePrices(offer.putStrikePercent, offer.callStrikePercent, startPrice);` -- convert to absolute values
                    - `putStrikePrice < startPrice && callStrikePrice > startPrice` -- {put < spot < call}
                    - [[#^CProviderNFT-mintFromOffer]] -- mint providerNFT to provider, save data on it
                    - `uint expiration = block.timestamp + offer.duration; require(expiration == providerNFT.expiration(providerId)` -- check expiration match, uses the same formula
                    - `positions[takerId] = TakerPositionStored({...; _mint(msg.sender, takerId);` -- save data, mint takerNFT to msg.sender (LoansNFT)
                    - `cashAsset.safeTransferFrom(msg.sender, address(this), takerLocked);` -- safe maxLoss on CTakerNFT contract
                        - on swap they got assets on LoansNFT, now we pull part that not for borrower, that depends on putStrike, the one that can be lossed == max loss
            - r `loanAmount >= minLoanAmount`
            - `_newLoanIdCheck` -- .underlyingAmount == 0
                - loanId = takerId; -- takerNFT's id, basically a loan id
            - `if (usesEscrow) _escrowValidations(loanId, escrowNFT, escrowId);`  -- loanIds, expiration of loanId match
            - mint loanNft, store data, send loan cash to borrower
    - forecloseLoan
        - Summary
            - Validations
            - Burn LoansNft
            - Burn takerNft, withdraw all (maxLoss in cash) from it
            - Swap it for U
            - Return escrowed U to Escrow + fees 
                - U on LoansNft from `openEscrowLoan`
            - And all the profit to borrower
        - only escrowed
        - `_isSenderOrKeeperFor(escrowOwner)` -- isSenderEqOwner || (keeperApprovedBySender && isKeeper)
            - only owner of the loanNft token
            - or closingKeeper set by LoansNft contract owner
                - but to set `keeperApproved[msg.sender]` only
        - `uint gracePeriodEnd = _expiration(loanId) + escrowGracePeriod(loanId);` -- 
            - `_expiration(loanId)` -- simple storage read from takerNft->providerNft ^LNft---expiration
                - set on [[#^CProviderNFT-mintFromOffer]]
            - `escrowGracePeriod(loanId)` -- timeAfforded paid from takerLocked(for maxLoss). capped from both min and max sides
                - convert `cashAvailable = takerPosition.withdrawable` to underlying
                - `loan.escrowNFT.cappedGracePeriod(loan.escrowId, underlyingAmount)` -- timeAfforded paid from takerLocked(for maxLoss). capped from both min and max sides ^ESNft-cappedGracePeriod
                    - uint timeAfforded = maxLateFee * YEAR * BIPS_BASE / escrow.escrowed / escrow.lateFeeAPR; -- get max fees takerPosition can pay from takerLocked(maxLoss), convert it to time
                        - takerPosition.withdrawable, how does it change? ^CTakerNft-positions--withdrawable
                            - set to 0 on `openPairedPosition`
                            - set to takerBalance on `settlePairedPosition` == takerLocked(maxLoss) + P&L == current collar value (on settle)
                            - set ot 0 on `withdrawFromSettled`
                        - maxLateFee == underlyingAmount == withdrawable cash from taker position converted to underlying == free funds we can spend
                        - Comment
                            - Calculate the grace period that can be "afforded" by maxLateFee according to few APR. -- basically because maxLateFee is set, not time, we need to calculate the time back from the fee
                             - fee = escrowed * time * APR / year / 100bips, so
                                 - escrowed -- [[#^ESNft---startEscrow--escrowed]]
                                 - time -- in seconds. It will be moved to the left of the formula below; Or == all the other vars will be moved to the left, then reverse the formula
                             - time = fee * year * 100bips / escrowed / APR; -- got it from the fee formula above
                    - return one of (MIN_GRACE_PERIOD; timeAfforded; escrow.maxGracePeriod)
        - r `block.timestamp > gracePeriodEnd` -- only after gracePeriod and can't pay grace fees, between 1 day and set by escrow owner
        - `_burn(loanId);` -- burn the LoanNft
        - `uint cashAvailable = takerNFT.withdrawFromSettled(_takerId(loanId));` -- get all withdrawable (on settle set to takerLocked(maxLoss) + P&L == current collar value) from `takerNft[id]`; burn CTakerNft; ^LNft-forecloseLoan--cashAvailable
            - onlyOwnerOf(takerId), only settled position
            - withdrawable was set on? -- See [[#^CTakerNft-positions--withdrawable]], on settle set to takerLocked(maxLoss) + P&L == current collar value (on settle)
            - `positions[takerId].withdrawable = 0;`
            - `_burn(takerId);`
            - `cashAsset.safeTransfer(msg.sender, withdrawal)` -- transfer all to LoanNFT
        - swap cash to underlying, see [[#^LNft---swap]]
        - `uint toBorrower = _releaseEscrow(escrowNFT, escrowId, fromSwap);` -- Escrow allowed to withdraw (funds from LoansNft); change goes to borrower ^LNft---releaseEscrow
            - -- ESNft released=true and withdrawable = debt(.escrowed) + fee + lateFee (most of the time debt x time x fee%); Funds sent from LoansNft;
            - -- profit from swap (U went down badly) or leftOver (U did not sink) goes to borrower
            - Note: below notes most of the time from `forecloseLoan` path, the function and inner function can be called with different values by other functions
            - `escrowNFT.currentOwed(escrowId)` -- debt(.escrowed) + lateFee{ (debt x time x fee%); 0 if still MIN_GRACE_PERIOD }
                - `getEscrow(escrowId);` -- simple read from storage
                - `ESNft._lateFee` -- grace => 0; default => debt x time x fee% ^ESNft---lateFee
                    - `block.timestamp < escrow.expiration + MIN_GRACE_PERIOD` -- still in grace period => 0
                        - escrow.expiration -- set on [[#^ESNft---startEscrow]] (start/switch)
                        - MIN_GRACE_PERIOD -- 1 day
                    - `Math.ceilDiv(escrow.escrowed * escrow.lateFeeAPR * overdue, BIPS_BASE * YEAR)` -- debt x time x fee%
                        - Somewhat similar formula to [[#^ESNft-cappedGracePeriod]]
                        - debt x time x fee
                        - set on [[#^ESNft-createOffer]], max 12%/year (12 bips)
            - uint toEscrow = Math.min(fromSwap, totalOwed); --escrow.escrowed + lateFee capped ^LNft---releaseEscrow--toEscrow
            - `escrowNFT.endEscrow(escrowId, toEscrow);` -- update escrow: released = true, withdrawable = owedCappedByAvailable; pull toEscrow from LNft; 
                - repaid = toEscrow = [[#^LNft---releaseEscrow--toEscrow]]
                - `_endEscrow(escrowId, getEscrow(escrowId), repaid)` -- update escrow: released = true, withdrawable = owedCappedByAvailable ^ESNft---endEscrow
                    - Note: reviewed for forecloseLoan, didn't recheck for switchEscrow, rollLoan, etc.
                    - r `msg.sender == escrow.loans`, `!escrow.released`
                        - [[#^EscrowSupplierNFT-escrows--released]]
                    - `_releaseCalculations` -- withdrawable = owedCappedByAvailable (to escrow by the system); toLoans = change left (all funds - escrowPart)
                        - [[#^ESNft---lateFee]]
                        - `_interestFeeRefund(escrow)` -- interestHeldByEscrow x timeLeftUntilEnd%, max 95%
                            - `uint elapsed = block.timestamp + duration - escrow.expiration; Math.min(elapsed, duration);` -- time passed after creation; capped by duration
                                - extended 
                                    - A: block.timestamp + duration -- now + duration
                                    - B: escrow.expiration -- creation time + duration
                                    - A - B = now - creation time = time from creation
                                - duration = escrow.duration = offer.duration -- escrow creation time (openLoan) + offer.duration
                                    - set on [[#^ESNft-createOffer]]
                                    - used on
                                        - `escrows[id].expiration = block.timestamp + offer.duration`
                            - `uint refund = escrow.interestHeld * (duration - elapsed) / duration;` -- interestHeld x timeLeftUntilEnd%
                                - escrow.interestHeld -- [[#^ESNft---startEscrow--interestHeld]] 
                                - (duration - elapsed) -- time left
                                - / duration -- convert time left to ration, float number, like %
                            - `uint maxRefund = escrow.interestHeld * MAX_FEE_REFUND_BIPS / BIPS_BASE; `-- 95% of interestHeld
                        - `uint targetWithdrawal = escrow.escrowed + escrow.interestHeld + lateFee - interestRefund;` -- owed to escrow by the system: escrow.escrowed + escrow.interestHeld when borrower created the escrow. lateFee for late payment. And `- interestRefund` for early payment ^ESNft---releaseCalculations--targetWithdrawal
                            - -- original escrow +  fees
                            - // everything owed: original escrow + (interest held - interest refund) + late fee
                            - escrow.escrowed -- [[#^ESNft---startEscrow--escrowed]] -- underlyingAmount
                            - [[#^ESNft---startEscrow--interestHeld]]
                        - `uint available = escrow.escrowed + escrow.interestHeld + fromLoans;` -- available in the system: escrow.escrowed + escrow.interestHeld is held on ESNft. `fromLoans` is available from swap of takeLockedEqMaxLoss ^ESNft---releaseCalculations--available
                            - escrowed and interestHeld hold somewhere? Or just numbers? -- held on EscrowSupplierNft.
                                - startEscrow
                                    - escrowed must be on offer, pulled from offer creator
                                    - fee held on EscrowSNft, pulled from LNft, pulled from borrower
                            - (original escrow  + interest held) + collarValueOnSettle
                            - underlyingAmount + originalFee + fromLoans (below)
                            - does originalUnderlying include takerLocked? -- yes, see [[#^LNft---openLoan--underlyingAmount]]
                            - fromLoans  -- on `forecloseLoan` (ignoring other paths) [[#^LNft---releaseEscrow--toEscrow]]
                        - withdrawal = Math.min(available, targetWithdrawal); -- owed by the systme for escrow capped by available in the system
                        - toLoans = available - withdrawal; -- collar position profit after fees ^ESNft---releaseCalculations--toLoans
                            - -- if owed to escrow < available in the system (for this collar position) return the change (== collar position minus all the fees is in profit); == if escrow part is less than available send the rest to LNft; Meaning that collar made a profit even after escrow fees + lateFees 
                            - [[#^ESNft---releaseCalculations--targetWithdrawal]]
                            - [[#^ESNft---releaseCalculations--available]]
                    - update released = true, withdrawable = owedCappedByAvailable
                    - returns: toLoans -- [[#^ESNft---releaseCalculations--toLoans]]
                - pull `repaid` from LoansNft, return change to LoansNft -- seems that it is collarValue; but they expect all funds, .escrowed + fees; see [[#^n3]]
                    - change = toLoans = [[#^ESNft---releaseCalculations--toLoans]]
                    - `repaid` = [[#^LNft---releaseEscrow--toEscrow]]
                - returns: toLoans -- [[#^ESNft---releaseCalculations--toLoans]]
            - return: underlyingOut = fromEscrow + leftOver; -- Collar profit (price grows/stays) + leftOver (in case of U big price drop)
                - fromEscrow -- see  [[#^ESNft---releaseCalculations--toLoans]]
                - leftOver = fromSwap - toEscrow; -- in case underlying dropped many times escrow stored underlying worth less
                    - [[#^LNft---releaseEscrow--fromSwap]]
                    - [[#^LNft---releaseEscrow--toEscrow]]
                    - when can we owe less than `fromSwap`? -- maybe if collateral drop to ~0, so all escrowed worth nothing. So `fromSwap` is a lot
        - `underlying.safeTransfer(borrower, toBorrower)`
        - Funds movement
            - On `openEscrowLoan` 
                - funds already on ESNft contract, after [[#^ESNft-createOffer]]
                - new funds are moved from borrower to LoansNft contract, sold and given to the borrower
                - part of the funds is kept on TakerNft contract, maxLoss
    - closeLoan -- settle, move funds to contracts, but some funds to borrower
        - `_settleAndWithdrawTaker` -- settle taker and provider, move taker's (tackerLocked + profit) to caller (LoansNft.sol)
            - `takerNFT.expirationAndSettled(takerId)` -- read
                - get expiration from providerNft
                - read settled from takerNFT storage
            - `takerNFT.settlePairedPosition(takerId)` -- for provider and taker, depending on P&Ls: move funds, update storage for their NFTs (settled=true and withdrawable), depending on P&Ls ^CTakerNft-settlePairedPosition
                - Summary
                    - get P&Ls for taker, provider
                    - move funds between taker and provider 
                    - set settle takerNft, providerNft
                    - write withdrawable for both
                - getPosition(takerId) -- ![[#^CTakerNft-getPosition]]
                - require exist, !expired, !settled
                - `_settlementCalculations` -- amounts P&Ls, capped by put/call strikes  ^CTNft---settlementCalculations
                    - uint startPrice = position.startPrice;
                        - set in [[#^CTakerNFT-openPairedPosition]] from oracle price of U at that time
                    - `_strikePrices(position.putStrikePercent, position.callStrikePercent, startPrice)` -- convert percents to price (`x startPrice`)
                        - putStrikePercent, callStrikePercent set in [[#^CProviderNFT-createOffer]], chose by provider(msg.sender)
                    - Math.max(Math.min(endPrice, callStrikePrice), putStrikePrice) -- capped price `[put; endPrice; call]`
                        - endPriceCappedAbove: Math.min(endPrice, callStrikePrice)
                            - when endPrice < callStrikePrice, call is OTM
                            - when call OTM use current price
                            - when call ITM use call price
                            - so limit the price by call price
                        - Math.max(endPriceCappedAbove, putStrikePrice)
                            - when endPriceCappedAbove > putStrikePrice use it
                            - but if endPrice below putStrikePrice use put strike
                            - so capped below by put strike
                    - takerBalance = position.takerLocked; --  [[#^CTakerNFT-openPairedPosition--takerLocked]]
                    - `if (endPrice < startPrice) {` -- has some loss from takerBalance=maxLoss, move asset from taker to provider
                        - `uint providerGainRange = startPrice - endPrice;` -- loss real, capped by put
                        - `uint putRange = startPrice - putStrikePrice;` -- maxLoss (below is covered by put)
                        - `uint providerGain = position.takerLocked * providerGainRange / putRange;` -- maxLoss x (realLoss / maxLoss) = realLoss
                        - takerBalance -= providerGain; providerDelta = providerGain.toInt256(); -- take from taker, add to provider
                            - why add to provider? -- to keep provider's payout constant between strikes
                                - provider has U. to keep the middle part straight on U price drop we need to pay them so (U + payment) stays constant; and on grow we need to take from them
                                - I guess that put writer will keep putStrike on them, so putWriterCashUsed + takerCashUsed + U price always constant. When below start Price. When above then surplus will be first given to taker, then to putWriterCallBuyer = collarWriter
                                - For provider pay off diagram is unlimited on both sides (profit on up, loss on down) and flat between strikes
                                    - like ![[Pasted image 20241203112555.png]]
                                    - https://forexop.com/strategy/forward-collar/
                                - U price dropped
                                - borrower's(B) put range (putStrike - start)
                                    - B has the right to sell their U for putStrike
                                    - if they return cash, want back U, they will get it
                                    - but to buy it back they need less cash, so from maxLoss = takerBalance some will be left
                                    - provider held U
                                    - provider got loss on U if counted in cash
                                    - ...
                                - Example
                                    - U was 1000, putStrike 900, callStrike 1100
                                    - price wall to 950
                                    - borrower 
                                        - gets back 1U, spend 900+50
                                        - 50 left
                                        - bought a put, have the right to sell for 900, OTM
                                        - wrote a call, have the obligation to sell for 1100, OTM
                                    - provider
                                        - wrote the put, have an obligation to buy by 900
                                            - but the price is above, so OTM, don't have to buy
                                        - bought a call, have the right to buy for 1100
                                            - OTM
                    - else -- move assets from provider to taker
                        - takerGainRange = endPrice - startPrice; -- profit capped by callStrike
                        - callRange = callStrikePrice - startPrice; -- max profit for taker
                        - position.providerLocked * takerGainRange / callRange -- locked x % of max profit
                - set .settled and allow taker to get their locked + profit 
                    - (putStike ... spot ... callStrike) => (0 ... takerLocked ... takerLocked x 2)
                - `providerNFT.settlePosition(providerId, providerDelta);` -- [[#^CProviderNFT-settlePosition]]
            - `takerNFT.withdrawFromSettled(takerId)` -- move takerId funds to LoanNft (msg.sender)
                - only NFT owner, !settled
                - burn NFT, transfer all withdrawable to caller(LoanNft in code)
                - returns: withdrawable (transfered)
                - see also [[#^LNft-forecloseLoan--cashAvailable]], explains withdrawFromSettled
        - uint repayment = loan.loanAmount; -- loaned to taker
            - set in? 
                - [[#^LNft-rollLoan]]
                - [[#^LNft---openLoan]]
                    - From [[#^LNFT---swapAndMintCollar]] , sent to borrower
        - pull from borrower loaned funds
        - uint cashAmount = repayment + takerWithdrawal; -- borrowed + lockedLeft + profit
        - swap to U
        - `_conditionalReleaseEscrow(loan, underlyingFromSwap)` -- pay escrow debt + fees from LoansNft.sol, mark released, returns cahnge from swap (goes to borrower)
            - `_releaseEscrow(loan.escrowNFT, loan.escrowId, fromSwap)` -- [[#^LNft---releaseEscrow]]
        - pay the leftOvers to borrower
        - [ ] ^sh
    - rollLoan -- create new Loan with new T&P pair ^LNft-rollLoan
        - onlyNFTOwner(loanId) -- no keeper
        - `canOpenPair(underlying, cashAsset, address(this)` -- whitelist
        - r `block.timestamp <= _expiration(loanId)`
            - `_expiration` -- ![[#^LNft---expiration]]
        - `_burn(loanId)` -- burn the LNft
        - `LNft._executeRoll(loanId, rollOffer, minToUser)` -- cancel last Pair, mint new, rearange cash ^LNft---executeRoll
            - `configHub.canOpenPair(underlying, cashAsset, address(rolls)` -- rollOffer.rolls (user-provided) WL
            - uint initialBalance = cashAsset.balanceOf(address(this));
            - rolls.previewRoll -- calc: settles, scale locked to new U price, deltas for P&T, fees
                - getRollOffer(rollId) -- simple read
                - offer.feeReferencePrice
                    - set on [[#^Rolls-createOffer]] from takerNFT.currentOraclePrice()
                - calculateRollFee -- base modified depending on price change ^Rolls-calculateRollFee
                    - price -- current oracle price
                    - `SignedMath.abs(offer.feeAmount).toInt256()` -- remove sign
                        - offer.feeAmount
                            - set on [[#^Rolls-createOffer]], user-provided, not checked
                            - > The base fee for the roll, can be positive (paid by taker) or negative (paid by provider)
                    - `int change = feeSize * offer.feeDeltaFactorBIPS * priceChange / prevPrice / int(BIPS_BASE);` -- feeAmtAbs x (fdf x priceChange%)
                        - offer.feeDeltaFactorBIPS, set on [[#^Rolls-createOffer]], < 100_00 (bips_base)
                            - > How much the fee changes with price, in basis points, can be negative. Positive means asset price increase benefits provider, and negative benefits user.
                        - priceChange -- now - start
                        - -- fee x fdf x priceDiff / prevPrice = fee x fdf x priceChange%
                        - comment --  feeAmtAbs x (fdf x priceChange%)
                            - // Scaling the fee magnitude by the delta (price change) multiplied by the factor.
                            - // For deltaFactor of 100%, this results in linear scaling of the fee with price.
                            - // So for BIPS_BASE the result moves with the price. E.g., 5% price increase, 5% fee increase.
                            - // If factor is, e.g., 50% the fee increases only 2.5% for a 5% price increase.
                    - rollFee = offer.feeAmount + change;
                        - offer.feeAmount -- in assets, base that will be used
                        - comment 
                            - // Apply the change depending on the sign of the delta * price-change.
                            - // Positive factor means provider gets more money with higher price.
                            - // Negative factor means user gets more money with higher price.
                            - // E.g., if the fee is -5, the sign of the factor specifies whether provider gains (+5% -> -4.75)
                            - // or user gains (+5% -> -5.25) with price increase.
                - ![[#^CTakerNft-getPosition]]
                - `_previewRoll` -- calc: settles, scale locked to new U price, deltas for P&T, fees ^Rolls---previewRoll
                    - (uint takerSettled, int providerGain) = takerNFT.previewSettlement(takerPos, newPrice) -- just calls [[#^CTNft---settlementCalculations]]
                    - `(uint newTakerLocked, uint newProviderLocked) = _newLockedAmounts(takerPos, newPrice)` -- scale maxLoss, maxProfit (both for taker) to the new U price ^Rolls---newLockedAmounts
                        - comment
                            - // New position is determined by calculating newTakerLocked, since it is the input argument.
                            - // Scale up using price to maintain same level of exposure to underlying asset.
                            - // The reason this needs to be scaled with price, is that this can should fit the loans use-case
                            - // where the position should track the value of the initial amount of underlying asset
                            - // (price exposure), instead of (for example) initial cash amount.
                            - // Note that this relationship is not really guaranteed, because initial underlying
                            - // to cash conversion was at an unknown swap-price.
                        - newTakerLocked = takerPos.takerLocked * newPrice / takerPos.startPrice; -- scale takerLocked to newPrice, 1:1
                            -  takerPos.takerLocked -- [[#^CTakerNFT-openPairedPosition--takerLocked]]
                            - `newPrice / takerPos.startPrice` -- price as % of oldPrice
                        - takerNFT.calculateProviderLocked( -- recalculate max profit
                            - See [[#^CTakerNFT-openPairedPosition--providerLocked]]
                    - protocolFee -- [[#^CProviderNft-protocolFee]]
                    - int toTaker = takerSettled.toInt256() - newTakerLocked.toInt256() - rollFee; -- delta to pull from/send to taker; == last position results - new locked (maxLoss) - rollFee
                        - takerSettled -- amt delta for taker
                        - newTakerLocked -- maxLoss scaled to new U price
                    - int toProvider = providerSettled - newProviderLocked.toInt256() + rollFee - protocolFee.toInt256(); -- delta balance for provider; last collar result - maxProfitForTaker + rollFee;
            - pull delta funds from taker, approve rolls for the funds and loanIdNft
            - rolls.executeRoll -- cancel last Paired, mint new Paired, rearange cash (m.c for Taker) ^Rolls-executeRoll
                - getRollOffer -- just load from storage
                - validations
                    - .active
                        - set to true on [[#^Rolls-createOffer]]
                        - set to false on [[#^Rolls-cancelOffer]] and [[#^Rolls-executeRoll]] (here)
                    - `msg.sender == takerNFT.ownerOf(offer.takerId)` -- r called by LoanNft (in code) ^Rolls--owner-of-new-offer
                        -  offer can be created only from old provider 
                        - `Rolls._executeRoll` -- safeTransferFrom(provider, roll offer.provider, msg.sender == takerNFT.ownerOf(offer.takerId), but
                            - Rolls.createOffer provider: msg.sender,
                                - It means provider created, and taker accepted
                                - And when createOffer check that it's called from old provider => old provider == newProvider, see [[#^n4--old-new-provider-on-createOffer]]
                    - `block.timestamp <= takerPos.expiration` -- not expired
                        - set on [[#^CProviderNFT-mintFromOffer]] to block.timestamp + offer.duration, between min and max (set by admins)
                            - offer.duration set on [[#^CProviderNFT-createOffer]], up to uint32
                    - U oracle price between rollOffer.maxPrice, minPrice
                        - set on [[#^Rolls-createOffer]], only checks min <= max
                    - rollOffer.deadline
                - `rollOffers[rollId].active = false`
                - [[#^Rolls-calculateRollFee]]
                - [[#^Rolls---previewRoll]]
                - r `toTaker >= minToTaker`
                    - minToTaker -- passed from top [[#^LNft-rollLoan]] by the caller
                        - `_executeRoll` minToUser
                            - rollLoan minToUser
                        - minToTaker will be used for verification later in [[#^LNft---executeRoll]]
                - toProvider >= offer.minToProvider
                    -  offer.minToProvider -- set on [[#^Rolls-createOffer]], not checked
                - `Rolls._executeRoll` -- cancel original Paired nfts (possibly old), mint new, rearange cash between P&m.c. for Taker ^Rolls---executeRoll
                    - Summary
                        - pull takerNft from m.s (~LoansNft)
                        - cancel both (see also [[#^n4]])
                        - open new paired P&T Nfts
                            - transfer TakerNft to m.s (~LNft.sol)
                            - transfer ProviderNft to offer.provider (original creator or a new offer)
                        - update-transfer cash
                            - provider's to provider
                            - taker's to m.s (~LoansNft)
                    - takerNFT.transferFrom(msg.sender, address(this), offer.takerId); -- pull from ~LoansNft.sol
                        - msg.sender -- LoansNft by default, ownership of offer.takerId checked in [[#^Rolls-executeRoll]]
                    - `_cancelPairedPositionAndWithdraw` -- both P&T: .settled(true), burn NFTs, transfer funds to Rolls (here)
                        - takerPos.providerNFT.approve(address(takerNFT), takerPos.providerId);
                            - why can we approve from rolls? -- pulled in [[#^Rolls-createOffer]]
                            - how do we know that it's correct providerId? How is it validated on takerPosition? -- seems to be unique and minted on [[#^CTakerNFT-openPairedPosition]]
                        - CTakerNft.cancelPairedPosition -- both P&T: .settled=true, burn NFTs, transfer funds to caller ^CTakerNft-cancelPairedPosition
                            - [[#^CTakerNft-getPosition]]
                            - validations
                                - msg.sender == ownerOf(takerId) -- Rolls.sol (caller) owns the NFT
                                    - msg.sender -- in code Rolls. Pulled from LNft.sol on [[#^Rolls---executeRoll]]
                                - msg.sender == providerNFT.ownerOf(providerId) -- Rolls.sol owns the NFT
                                - !settled
                                    - false on [[#^CTakerNFT-openPairedPosition]]
                                    - true on [[#^CTakerNft-settlePairedPosition]]
                                    - true on here ([[#^CTakerNft-cancelPairedPosition]])
                            - `positions[takerId].settled = true;`
                            - `burn(takerId)`
                            - [[#^CProviderNFT-cancelAndWithdraw]]
                            - transfer both takerLocked, providerLocked to msg.sender (Rolls)
                                - How come we have takerLocked? -- it is CTakerNft, so on [[#^CTakerNFT-openPairedPosition]]
                        - uint expectedAmount = takerPos.takerLocked + takerPos.providerLocked; -- cached value == real values
                    - pull from ~LNft `-toTaker`, from provider (`-toProvider`)
                        - if diff is negative we need to pull, otherwise push
                    - `_openNewPairedPosition` -- create ProviderOffer; create pairedPosition (P&T nfts, owner=Rolls)
                        - uint offerAmount = preview.newProviderLocked + preview.protocolFee; -- new maxLoss + new protocolFee
                            - preview.newProviderLocked -- maxLoss scaled to new U price
                                - -- calculated in [[#^LNft---executeRoll]] ->  [[#^Rolls---previewRoll]] -> [[#^Rolls---newLockedAmounts]] 
                            - preview.protocolFee -- same as above, see [[#^CProviderNft-protocolFee]]
                        - `cashAsset.forceApprove(address(providerNFT), offerAmount);`
                        - [[#^CProviderNFT-createOffer]]
                        - cashAsset.forceApprove(address(takerNFT), preview.newTakerLocked);
                        - [[#^CTakerNFT-openPairedPosition]]
                            - does it use old providerNft or newly minted? -- new, in theory, we provide a newly created providerOffer => PairedPosition (P&T nfts) => RollOffer
                                - back through callstack, up to `openPairedPosition`
                                    - Call stack top to bottom ^rollLoan-call-waterfall
                                        - provider1 calls [[#^CProviderNFT-createOffer]] 
                                            - get LiquidityOffer.offerId
                                                - .provider set to msg.sender (provider1)
                                            - pulled cash from msg.sender
                                        - ms2 calls [[#^CTakerNFT-openPairedPosition]]
                                            - provide LiquidityOffer.offerId
                                            - get takerId (minted to msg.sender (ms2), takerId2), 
                                            - get paired providerId (minted to offer.provider (provider1))
                                        - Note: 2 above are not required, it seems that we use old takerId
                                        - provider1 calls [[#^Rolls-createOffer]]
                                            - provide takerId
                                            - providerNft1 pulled from provider1 to Rolls
                                            - rollOffer
                                                - .provider = msg.sender = provider1
                                                - .providerId = providerNft1
                                                - .takerId = takerId2
                                            - returns rollId3
                                        - loanOwner=borrower=loanOwner4 calls [[#^LNft-rollLoan]]
                                            - provides loanId4 (owned by loanOwner4)
                                            - rollOffer.id = rollId3 (provider1, providerNft1, takerId2)
                                            - in -> `Rolls._executeRoll` providerNft1 and paired takerId2 will be cancelled, new ones will be opened from Rolls: providerNft5 and takerNft5
                                    - Note: maybe not finished
                                    - -- -> `_executeRoll(preview)` -> `_openNewPairedPosition(preview)` -> openPairedPosition(preview.takerPos.providerNFT)
                                    - <- in `_openNewPairedPosition` read from preview.takerPos.providerNFT
                                    - <- `preview` passed to `Rolls._executeRoll`
                                    - <- `preview`  set in `Rolls.executeRoll`
                                        - from `_previewRoll(takerPos)`
                                        - `takerPos = takerNFT.getPosition(offer.takerId)` steps top to bottom
                                            - offer.takerId from getRollOffer(rollId)
                                            - rollId from `rollOffer` in `LNft._executeRoll`
                                            - passed by caller
                                            - RollOffer.id set it Rolls.createOffer
                                            - takerId passed by user
                                            - can be created on openPairedPosition
                    - push cash toTaker, toProvider
                    - transfer TakerNft to m.s (~LoansNft)
                    - Qs
                        - offer.takerId vs preview.takerPos in `Rolls._executeRoll` -- same
                            - offer.takerId
                                - from `rollId` passed by user
                            - takerPos -- same, read like takerNFT.getPosition(offer.takerId)
                            - preview.takerPos -- unchanged takerPos
                            - preview.takerPos.providerId -- paired to offer.takerId
            - push toTaker cash to taker
            - verify balance not changed
        - getLoan(loanId) -- just load from storage
        - `_loanAmountAfterRoll` -- just +- toUser, no new calculations
            - params
                - fromRollsToUser = toUser = toTaker -- diff to send to taker after roll
                - rollFee -- from [[#^Rolls-calculateRollFee]]
                - prevLoan.loanAmount -- in cash
            - int loanChange = fromRollsToUser + rollFee;
                - if we calculated that the user get funds loan amount change down. Otherwise up
        - `_newLoanIdCheck` -- check `loans[takerId].underlyingAmount` == 0
        - `_conditionalSwitchEscrow`  -- end, start, transfer fees
            - params
                - newFee -- user provided
            - `configHub.canOpenSingle(underlying, address(escrowNFT)` -- WL
            - pull newFee from borrower=taker=m.s
            - escrowNFT.switchEscrow -- end + start, handle fee transfers with m.s (~LNft)
                - !expired
                - comment  above `_endEscrow` -- about funds internal accounting
                    1. initially user's escrow "E" secures old ID, "O". O's supplier's funds are away.
                    2. E is then "transferred" to secure new ID, "N". N's supplier's funds are taken, to release O.
                    3. O is released (with N's funds). N's funds are now secured by E (user's escrow).
            
                    - Interest is accounted separately by transferring the full N's interest fee
                    - (held until release), and refunding O's interest held.
            
                    - // "O" (old escrow): Release funds to the supplier.
                    - // The withdrawable for O's supplier comes from the N's offer, not from Loans repayment.
                    - // The escrowed loans-funds (E) move into the new escrow of the new supplier.
                    - // fromLoans must be 0, otherwise escrow will be sent to Loans instead of only the fee refund.
                - [[#^ESNft---endEscrow]]
                - [[#^ESNft---startEscrow]]
                - pull/push fee updates from/to caller (~LNft)
            - `_escrowValidations` -- loanId and expiration
            - transfer feeRefund to borrower=taker=m.s
        - write to storage, mint LNft
    - [ ] unwrapAndCancelLoan ^LNft-unwrapAndCancelLoan

    - [ ] `_endEscrow` ^LNft---endEscrow
        - [ ] See [[#^ESNft---endEscrow]]
        - Called by
            - ESNft.endEscrow
            - ESNft.switchEscrow
- EscrowSupplierNFT
    - startEscrow -- Starts a new escrow using funds from an existing offer or part of it ^ESNft-startEscrow
        - Only by `loansCanOpen[msg.sender]`, checked in [[#^ESNft---startEscrow]]
        - takerNFT -- immutable, set in constructor
        - escrowed -- on open borrower-provided underlyingAmount
        - everything else is user provided
        - `escrowId = _startEscrow(offerId, escrowed, fee, loanId);` -- Remove `escrowed` amount from `offers[offerId].available`, create `escrows[escrowId]`, add to `escrows[escrowId]`  ^ESNft---startEscrow
            - escrowed -- set only on [[#^ESNft---startEscrow]], never changed. After `_openLoan` will be borrower-provided  underlyingAmount  ^ESNft---startEscrow--escrowed
            - called by: startEscrow and switchEscrow
            - `require(loansCanOpen[msg.sender], "escrow: unauthorized loans contract");` -- whitelisted msg.sender
            - `require(configHub.canOpenSingle(asset, address(this)), "escrow: unsupported escrow");` -- check again that can open, last checked in [[#^LNft---conditionalOpenEscrow--canOpenSingle]]
                - asset -- set in constructor of EscrowSupplierNFT; checked to be `underlying` in [[#^LNft---conditionalOpenEscrow]] above
            - `Offer memory offer = getOffer(offerId);` -- load from storage
                - How is it set in storage? -- [[#^ESNft-createOffer]] and [[#^ESNft-updateOfferAmount]]
            - `require(offer.supplier != address(0), "escrow: invalid offer"); // revert here for clarity` -- make sure offer is set
            - `require(configHub.isValidCollarDuration(offer.duration), "escrow: unsupported duration");` -- `min <= duration <= max`
            - `require(fee >= interestFee(offerId, escrowed), "escrow: insufficient fee");` -- on `startEscrow` set by user; can provide bigger fee than ceil(required), but not less ^ESNft---startEscrow--fee
                - on `startEscrow` set by user
                - ceil( escrowed x APR x duration / (bips x seconds per year) )
            - `require(escrowed >= offer.minEscrow,`
            - `uint prevOfferAmount = offer.available; require(escrowed <= prevOfferAmount,` -- <= than deposited
                - offer.available -- amount on ESNft. set on `createOffer`, and updated on `updateOfferAmount`.  Transfers that amount to/from msg.sender.
            - `offers[offerId].available -= escrowed;` 
            - `escrowId = nextTokenId++;`
            - `escrows[escrowId] = EscrowStored({ ... });`
                - `escrowId` -- EscrowSupplierNFT.tokenId
                - `EscrowStored({ ... })`
                    - `offerId` -- user provided
                    - `loanId` --  `takerNFT.nextPositionId()`  in [[#^LNft---conditionalOpenEscrow]]
                    - `expiration:`
                    - `released: false` ^EscrowSupplierNFT-escrows--released
                        - Updated in 
                            - ESNft.lastResortSeizeEscrow -- = true
                            - [[#^LNft---endEscrow]] -- = true
                            - Used in
                                - withdrawReleased -- require(released)
                                - lastResortSeizeEscrow -- !released
                                - [[#^LNft---endEscrow]] -- !released
                    - `loans: msg.sender` -- LoanNft by default; checked on [[#^LNft---endEscrow]], only loans can end
                        - msg.sender is LNft by default
                        - msg.sender is checked to be `loansCanOpen`
                    - `escrowed: escrowed`
                    - `interestHeld: fee` ^ESNft---startEscrow--interestHeld
                        - = fee that is >= escrowed x duration x APR on `_startEscrow` 
                            - set to fee on [[#^ESNft---startEscrow]], see also [[#^ESNft---startEscrow--fee]]
                        - Used in
                            - `lastResortSeizeEscrow` -- returned to the ownerOf(escrowId)
                            - set in `_startEscrow` (here)
                            - part of targetWithdrawal and available in `_releaseCalculations` <- [[#^LNft---endEscrow]]/`previewRelease`
                                - `_interestFeeRefund` reduces it on time elapsed, so refund is the bigger the earlier you withdraw -- returned to `loanNft` contract
                                    - `toLoans` returned to msg.sender on `endEscrow`. `msg.sender` must be `loans`. `loans` is LoanNft by defualt
                        - GPT -- [[#The Purpose and Utilization of `interestHeld`]]
                    - `withdrawable: 0`
                        - Set to 0 on `withdrawReleased`
                        - Set to nonZero on [[#^LNft---endEscrow]]
                        - Used in
                            - `withdrawReleased` -- set to 0, sent to msg.sender == ownerOf(escrowId)
                            - on [[#^LNft---endEscrow]] from `_releaseCalculations` -- basically something like depositedButNotLent or balanceOf. not 100% understand btw
                                - `withdrawal = Math.min(available, targetWithdrawal);`
                                    - `uint targetWithdrawal = escrow.escrowed + escrow.interestHeld + lateFee - interestRefund;` -- deposited and not lent + fee from deposit + lateFee - refundForBorrower
                                    - `uint available = escrow.escrowed + escrow.interestHeld + fromLoans;` -- deposited and not lent + fee from deposit + ~repaid
                        - GPT -- [[#`withdrawable` in `EscrowStored`]]
            - `_mint(offer.supplier, escrowId);` -- simple mint, check that is not minted before (revert)
                - offer.supplier -- set on [[#^ESNft-createOffer]] to msg.sender (some supplier, who provided asset for the offer)
        - `asset.safeTransferFrom(msg.sender, address(this), escrowed + fee); asset.safeTransfer(msg.sender, escrowed);` -- pull fee from msg.sender (LoanNFT usually), 2 transfers for tax reasons, see GPT's [[#CGT Tax Implications in `startEscrow`]]]
    - [ ] createOffer ^ESNft-createOffer
    - [ ] updateOfferAmount ^ESNft-updateOfferAmount
    - [ ] switchEscrow ^ESNft-switchEscrow
- CollarProviderNFT
    - settlePosition -- pull/push delta from/to taker; set withdrawable; set settled=true ^CProviderNFT-settlePosition
        - Comment explained by GPT: [[#Why Automatic Withdrawals to Providers are Undesirable in the `settlePosition` Function]]
        - onlyTaker
        - exist, !expired, !setttled
        - set settled
        - initial = position.providerLocked -- [[#^CTakerNFT-openPairedPosition--providerLocked]]
            - set on [[#^CProviderNFT-mintFromOffer]]
            - passed from [[#^CTakerNFT-openPairedPosition]]
            - calculated in [[#^CTakerNFT-openPairedPosition--providerLocked]]
        - `if (cashDelta > 0) {` -- U down, profit for the provider, loss for the taker; pull funds from taker on CProviderNft contract; allow provider to withdraw initial + fromTaker
            - when does provider get profit?
                - when price of U drops
                - in [[#^CTNft---settlementCalculations]], but it's capped by maxLoss of taker
            - position.withdrawable = initial + toAdd;
                - initial = position.providerLocked
                - no need to pay anything, but get up to maxLoss from taker
            - pull funds from taker
        - else { -- U up; loss for provider, profit for taker; just send to taker, allow provider to withdraw less
            - capped by maxProviderLoss
                - What about edge cases? -- seems to allow initial (100%), so should be fine
        - Called by [[#^CTakerNft-settlePairedPosition]]
    - cancelAndWithdraw -- .settled = true, burn nft, transfer all funds to caller ^CProviderNFT-cancelAndWithdraw
        - validations
            - .expiration != 0 -- set
            - !settled
                - false on [[#^CProviderNFT-mintFromOffer]]
                - true on [[#^CProviderNFT-settlePosition]]
                - true on [[#^CProviderNFT-cancelAndWithdraw]] (here)
            - `bool callerApprovedForId = _isAuthorized(ownerOf(positionId), msg.sender, positionId);` -- isOwner || isOperator || isApproved
        - providerPosition.settled = true
        - `_burn(positionId)`
        - transfer all locked to msg.sender (CTakerNft in code), but no update
    - mintFromOffer -- write position data to storage and mint NFT ^CProviderNFT-mintFromOffer
        - `onlyTaker` -- ~CTakerNFT
            - who is taker here? -- immutable, set on creation; probably only CTakerNFT
            - Called only from in code [[#^CTakerNFT-openPairedPosition]]
        - `configHub.canOpenPair(underlying, cashAsset, msg.sender`, `configHub.canOpenPair(underlying, cashAsset, address(this)` -- taker and provider whitelisted
        - `configHub.isValidLTV(ltv)` -- min <= ltv <= max
        - `configHub.isValidCollarDuration(offer.duration)` -- min <= duration <= max
        - `(uint fee, address feeRecipient) = protocolFee(providerLocked, offer.duration);` -- up to 1% per year, depends on offer.duration ^CProviderNft-protocolFee
            - configHub.feeRecipient() == address(0) ? 0
            -  `Math.ceilDiv(providerLocked * configHub.protocolFeeAPR() * duration, BIPS_BASE * YEAR)` -- fee in cash amount, depends on offer.duration
                -  `providerLocked * configHub.protocolFeeAPR() * duration` -- fee for the duration of the position
                    -  `providerLocked` -- funds locked on the provider, max profit for taker
                    -  `configHub.protocolFeeAPR()` -- fee per year, up to 1%; in bips
                        - GPT: [[#The `protocolFeeAPR`]]
                    -  `duration` -- LiquidityOffer.duration, seconds, set on LiquidityOffer creation
                -  `BIPS_BASE * YEAR` 
                    - /BIPS_BASE -- "convert" protocolFeeAPR to normal "float"
                    - /YEAR -- convert protocolFeeAPR to per second
        - `providerLocked >= offer.minLocked` -- because amt is from taker, make sure taker order is not too small
            - providerLocked -- amt x (callStrike - spot), [[#^CTakerNFT-openPairedPosition--providerLocked]]
            - offer.minLocked -- LiquidityOffer, set by provider
        - `uint prevOfferAmount = offer.available; providerLocked + fee <= prevOfferAmount` -- to lock + fee <= available
        - `uint newAvailable = prevOfferAmount - providerLocked - fee; liquidityOffers[offerId].available = newAvailable;` -- remove locked and fee from unfilled order
        - `positionId = nextTokenId++; positions[positionId] = ProviderPositionStored({` -- just write everything to storage
        - `_mint(offer.provider, positionId);` -- mint the NFT representing `ProviderPositionStored` above
        - `if (fee != 0) cashAsset.safeTransfer(feeRecipient, fee);` -- send fee
    - createOffer -- validate, write storage, pull amount from `msg.sender` ^CProviderNFT-createOffer
        - 100_01 <= callStrikePercent <= 1000_00 -- 100,01% - 1000%
            - See usage of callStrikePercent here [[#^CTakerNFT-openPairedPosition--providerLocked]]
        - putStrikePercent <= 99_99
        - duration <= uint32 -- ~100years
- CollarTakerNFT
    - getPosition -- read some data from storage, some from providerNft's storage, validate .providerNft set ^CTakerNft-getPosition
- ChainlinkOracle
    - currentPrice ^ChainlinkOracle-currentPrice
- CombinedOracle
    - currentPrice ^CombinedOracle-currentPrice
- Rolls ^Rolls
    - createOffer ^Rolls-createOffer
        - Only from old provider: takerNFT.getPosition(takerId) => takerPos.providerId => providerNFT.ownerOf(providerId) == msg.sender
    - cancelOffer ^Rolls-cancelOffer
    - executeRoll [[#^Rolls-executeRoll]]

## Md chunks (GPT)

### The Purpose and Utilization of `interestHeld`

The `interestHeld` variable, found within the `EscrowStored` struct in the `EscrowSupplierNFT.sol` contract, represents the upfront interest fee paid by the borrower to the escrow supplier at the start of an escrow-backed loan. This fee is calculated based on the offer's interest rate, duration, and the escrowed amount, and is designed to compensate the supplier for their service and the opportunity cost of locking up their funds.

Here's how `interestHeld` is used within the contract:

- **Initialization:** When a new escrow agreement is initiated via the `startEscrow` function, the borrower provides the escrowed amount along with the upfront interest fee. This fee is then stored in the `interestHeld` variable of the newly created `EscrowStored` struct for that specific escrow agreement.
- **Escrow Termination:** Upon loan repayment or when the escrow is released using `endEscrow`, the `_releaseCalculations` function determines the final amount to be returned to the borrower, taking into account potential late fees and refunds. This function considers the `interestHeld` amount when calculating the target withdrawal amount for the supplier.
- **Early Release Refund:** If the escrow is released before the full loan duration, a portion of the `interestHeld` fee might be refunded to the borrower. The `_interestFeeRefund` function calculates this refund based on the remaining duration of the escrow.
- **Last Resort Seizure:** If the escrow provider invokes the `lastResortSeizeEscrow` function after the grace period, they receive the full escrowed amount plus the `interestHeld` fee as compensation for the borrower's default.

**Key Points Regarding `interestHeld`:**

- It reflects the upfront payment model for interest in escrow-backed loans within this system.
- It contributes to the calculation of the supplier's total earnings upon escrow termination.
- It may be partially refunded to the borrower if the escrow is released early.
- It represents a source of compensation for the supplier in case of a last-resort seizure.

**Important Note:** The contract doesn't directly use the annual percentage rate (APR) when calculating the interest refund during early release. Instead, it uses a simpler proportional calculation based on the elapsed time and the total `interestHeld` amount to ensure consistency and avoid rounding discrepancies.

### `withdrawable` in `EscrowStored`

The `withdrawable` variable, part of the `EscrowStored` struct in **EscrowSupplierNFT.sol**, represents the total amount of underlying tokens that the escrow supplier can withdraw once the escrow agreement is concluded and the `released` flag is set to `true`. This amount includes the original `escrowed` amount, the accrued `interestHeld` fee, any applicable late fees, and potential deductions due to shortfalls or refunds.

#### Usage of `withdrawable`

- **Initialization:** When an escrow agreement is created using the `startEscrow` function, `withdrawable` is initially set to 0. It remains at 0 until the escrow is released.
- **Escrow Termination:** When the `endEscrow` function is called, typically triggered by loan repayment or a last-resort seizure, the `_releaseCalculations` function determines the final `withdrawable` amount for the supplier. This calculation considers the `repaid` amount from the borrower, any late fees, and potential interest refunds.
- **Withdrawal by Supplier:** Once `released` is `true`, the escrow supplier can invoke the `withdrawReleased` function to withdraw the funds represented by `withdrawable`. This function transfers the specified amount of underlying tokens from the escrow contract to the supplier's address.

#### Key Points

- `withdrawable` serves as a temporary holding place for the supplier's earnings until they are withdrawn.
- It ensures that the supplier receives the correct payout upon escrow termination, factoring in all relevant fees and adjustments.
- The `withdrawable` value is 0 until the escrow is released, preventing premature withdrawals by the supplier.

#### Illustrative Example

Let's say a borrower starts an escrow-backed loan for 100 ETH with an upfront interest fee of 1 ETH. The `escrowed` amount would be 100 ETH, and `interestHeld` would be 1 ETH. Initially, `withdrawable` would be 0.

If the borrower repays the loan on time and in full, the `endEscrow` function would be called with a `repaid` amount of 100 ETH. The `_releaseCalculations` function would determine that no late fees are due and no interest refund is applicable. As a result, `withdrawable` would be set to 101 ETH (100 ETH `escrowed` + 1 ETH `interestHeld`). The supplier could then withdraw this amount using `withdrawReleased`.

If the borrower fails to repay the loan, the supplier could choose to invoke `lastResortSeizeEscrow` after the grace period. In this scenario, `withdrawable` would be set to the sum of `escrowed` and `interestHeld` (101 ETH), and the supplier could withdraw this amount.
#### Note

The sources do not explicitly mention how `withdrawable` is affected by partial repayments or shortfalls during loan repayment. This behavior would depend on the specific implementation of the `_releaseCalculations` function and how it handles such situations.

### CGT Tax Implications in `startEscrow`

The phrase "from CGT tax lows perspective" in the `startEscrow` function's comments in **** refers to the careful structuring of asset transfers to potentially achieve favorable treatment under Capital Gains Tax (CGT) regulations. The objective is to ensure that the underlying tokens used for the swap in the `LoansNFT.sol` contract are considered to be supplied by the escrow provider ("supplier's" funds) and not the borrower ("borrower's" funds).

Here's a breakdown of how the code achieves this:

- **Separate Transfers:** The `startEscrow` function in **** executes two distinct token transfers:
    
    1. **Borrower to Escrow:** The borrower's funds, consisting of the escrowed amount and the upfront interest fee, are transferred from the borrower (`msg.sender`) to the escrow contract (`address(this)`).
    2. **Escrow to Loans:** The escrow contract then transfers only the escrowed amount to the `LoansNFT.sol` contract (`msg.sender`), effectively mimicking the supplier providing the funds for the loan.
- **Rationale:** This two-step transfer process aims to establish a clear separation between the borrower's initial deposit and the funds used for the swap in the lending contract. By routing the funds through the escrow contract, the code attempts to portray the transaction as the supplier providing the tokens for the loan, potentially minimizing the borrower's immediate CGT liability.
    
- **Tax Implications:** The exact tax implications would depend on the specific jurisdiction's CGT regulations. However, by structuring the transfers in this manner, the code seeks to:
    
    - **Defer Capital Gains:** Delay the recognition of capital gains until the loan's maturity or the eventual sale of the underlying asset by the supplier.
    - **Reduce Taxable Event:** Potentially avoid triggering an immediate taxable event upon loan initiation by attributing the asset transfer to the escrow provider.

**Important Considerations:**

- **Jurisdictional Variations:** The effectiveness of this strategy would vary significantly based on the specific tax laws of the jurisdiction in question.
- **Not Tax Advice:** The sources and this explanation do not constitute legal or tax advice. Borrowers and suppliers should consult with qualified tax professionals to fully understand the CGT implications of these transactions.

It's crucial to remember that tax laws are complex and subject to change. The code's approach might not guarantee a specific tax outcome, and users should seek professional guidance to ensure compliance with applicable regulations.
### What is LoanNFT.underlying?
The `LoanNFT.underlying` variable refers to the **underlying asset** used in a specific asset pair of the Collar protocol.

- The `LoansNFT.sol` contract manages opening, closing, and rolling of loans through **Collar positions** with optional escrow support.
- The underlying and cash assets are determined by the `CollarTakerNFT` contract associated with the `LoansNFT` contract.
- The `underlying` variable in `LoansNFT` is an instance of `IERC20`, representing the **ERC-20 token used as collateral** for loans in a specific asset pair.

For example, in the deployment script `combined-script.sol.txt`, `LoanNFT.underlying` is set to `WETH` for the `WETH/USDC` pair. This means **WETH is the collateral asset**, and users would supply WETH to borrow USDC.

The `LoanNFT.sol` contract also handles the swapping of the underlying asset to the cash asset through allowed swappers. When a loan is opened, the underlying asset is swapped for the cash asset. When the loan is closed, the cash asset is swapped back to the underlying asset.

The `LoansNFT` contract uses a **ConfigHub** contract to determine which asset pairs are supported for opening loans. This allows the protocol to be flexible and support different asset pairs.

### The Cash Asset Used in LoanNFT

The `LoanNFT.cashAsset` variable refers to the ERC-20 token used as the borrowed asset in a particular asset pair within the Collar Protocol. Let's break this down.

*   The `LoansNFT.sol` contract is responsible for managing the lifecycle of loans, encompassing the processes of opening, closing, and rolling of loans facilitated through **Collar positions**, potentially integrated with escrow services.
*   The specific underlying and cash assets used in a loan are determined by the associated `CollarTakerNFT` contract.
*   The `cashAsset` variable in `LoansNFT` is declared as an immutable instance of the `IERC20` interface. This signifies that once the `LoansNFT` contract is deployed, the `cashAsset` cannot be changed.

**How it Works**

1.  **Loan Initiation:** When a user wants to borrow, they initiate a loan by providing the underlying asset as collateral. The `LoansNFT` contract, using a designated swapper contract, then swaps this underlying asset for the corresponding cash asset.
2.  **Loan Disbursement:** The borrowed amount, now in the form of the cash asset, is transferred to the borrower.
3.  **Loan Closure:** When the borrower is ready to repay the loan, they return the borrowed amount in the form of the cash asset. This cash asset is then swapped back to the underlying asset, which is then returned to the borrower.

**Deployment Example**

In the deployment script `combined-script.sol.txt`, the `LoanNFT.cashAsset` is configured to be `USDC` for the `WETH/USDC` asset pair. This implies that users would supply `WETH` (the underlying asset) as collateral to borrow `USDC` (the cash asset).

**Flexibility and Protocol Governance**

The `LoansNFT` contract leverages a `ConfigHub` contract to govern which specific asset pairs are supported for loan origination. This architecture provides flexibility in accommodating various asset pairs and adapts to changing market conditions and risk management needs.

It is important to note that the relationship between the underlying and cash assets is crucial in determining the direction of swaps during loan origination and closure. The sources don't explicitly state this, but based on common DeFi practices, it is likely that the `LoansNFT` contract is designed to work with asset pairs where the cash asset is considered more stable than the underlying asset. This is a reasonable assumption as it aligns with the goal of mitigating the risk of collateral devaluation for lenders. This is an inference based on common DeFi practices, and you may want to verify it independently.&#x20;

### Understanding the Roles of `cashAsset` and `underlying`

The terms `cashAsset` and `underlying` represent the two key components of an asset pair within the context of the Collar protocol, specifically within the `LoanNFT` contract.

- **`cashAsset`:** This is the **borrowed asset**, represented as an `IERC20` token. When a user takes out a loan, they receive this asset. During loan repayment, this is the asset the borrower repays.
- **`underlying`:** This is the **collateral asset**, also represented as an `IERC20` token. Users provide this asset to secure their loans. It is swapped for `cashAsset` at the beginning of the loan and swapped back when the loan is closed.

The specific `cashAsset` and `underlying` for a given loan are determined by the `CollarTakerNFT` contract associated with the loan.

For instance, the `combined-script.sol.txt` source demonstrates the deployment of a `WETH/USDC` pair, where:

- `WETH` is the `underlying` asset, acting as collateral.
- `USDC` is the `cashAsset`, the asset borrowed by users.

#### Relationship and Risk Mitigation

While the sources don't explicitly state this, it's likely, based on common DeFi practices, that the `cashAsset` is typically a more **stable** asset compared to the `underlying` asset. This design choice aims to mitigate the risk of collateral devaluation for lenders. For instance, using a stablecoin like USDC as `cashAsset` reduces the risk associated with volatile assets like ETH, which could be used as `underlying`. This is an inference, and you may want to verify it.

#### Interactions in Loan Operations

The `LoansNFT` contract manages the interaction between these assets throughout the loan lifecycle:

1. **Loan Opening:**
    - The borrower provides the `underlying` asset.
    - The `LoansNFT` contract, using allowed swappers, swaps the `underlying` for the `cashAsset`.
    - The borrower receives the `cashAsset` as the loan.
2. **Loan Closure:**
    - The borrower repays the loan using the `cashAsset`.
    - The `cashAsset` is swapped back to the `underlying` asset.
    - The borrower receives the `underlying` asset back.

This structure ensures a consistent flow of assets, facilitating the lending and borrowing operations within the protocol.

### A Comparative Analysis of TakerNFT and ProviderNFT Contracts

The sources detail the functionality and interaction of the `takerNFT` and `providerNFT` contracts within the Collar protocol. These contracts play distinct roles in facilitating the protocol's core operations:

- **`takerNFT` (`CollarTakerNFT.sol`)**:
    - Manages the taker side of the Collar protocol.
    - Handles position settlement, drawing upon oracle prices.
    - Interacts with provider NFTs to establish zero-sum paired positions.
- **`providerNFT` (`CollarProviderNFT.sol`)**:
    - Enables liquidity providers to create offers.
    - Manages provider positions and the associated protocol fees.
    - Facilitates provider-side position settlement initiated by the taker NFT and handles provider withdrawals.

#### Intertwined Roles: Creating and Settling Paired Positions

A closer examination of the source code reveals the specific functions and interactions between these contracts:

1. **`openPairedPosition` in `CollarTakerNFT.sol`**: This function initiates the creation of a paired position. It receives parameters such as the amount to be locked by the taker (`takerLocked`), the address of the provider NFT contract, and the ID of the offer.
    
    - The function checks if both the taker and provider contracts are permitted to open positions for the specified asset pair using the `ConfigHub` contract.
    - It calculates the amount to be locked by the provider (`providerLocked`) based on the taker's locked amount and the strike prices specified in the offer.
    - The function ensures the validity of the offer and verifies that strike prices are distinct to avoid edge cases during settlement.
    - It calls the `mintFromOffer` function on the provider NFT contract to mint a provider position, transferring the corresponding provider NFT to the original offer provider.
    - Finally, it mints a taker NFT to the sender, representing their side of the position, and transfers the taker's locked funds to the contract.
2. **`mintFromOffer` in `CollarProviderNFT.sol`**: This function is called by the taker NFT contract to create a provider position linked to an existing offer.
    
    - It ensures that the taker contract is allowed to open positions for the specified asset pair and that the offer parameters are still supported by the protocol configuration.
    - The function calculates and deducts the protocol fee based on the provider's locked amount and the duration of the position, sending the fee to the designated recipient.
    - It updates the offer amount to reflect the new available liquidity after deducting the minted position and protocol fee.
    - Finally, it mints the provider NFT, representing ownership of the position, to the original offer provider.
3. **`settlePairedPosition` in `CollarTakerNFT.sol`**: This function handles the settlement of a paired position after its expiration.
    
    - It utilizes the current oracle price to determine the final payout.
    - The function calculates the final balances for both the taker and provider based on the ending price and the strike prices.
    - It updates the taker position's state to reflect settlement and the withdrawable amount.
    - The function calls the `settlePosition` function on the provider NFT contract to transfer funds between the contracts according to the settlement outcome.
4. **`settlePosition` in `CollarProviderNFT.sol`**: This function is invoked by the taker NFT contract during settlement to adjust balances between the contracts.
    
    - It ensures the validity of the position ID and verifies that the position has not been previously settled.
    - The function calculates the amount of cash to be added to or removed from the provider position based on the settlement outcome (`cashDelta`).
    - It updates the provider position's state to reflect settlement and the withdrawable amount.
    - The function transfers funds between the contracts according to the settlement outcome, requiring approval from the taker contract if the provider is due funds.

#### Distinct Responsibilities: Minting, Withdrawals, and Cancellations

Beyond the shared responsibility for paired position creation and settlement, the contracts have distinct functions:

- **`takerNFT`**:
    - Calculates the `providerLocked` amount based on the `takerLocked` amount and the strike prices.
    - Handles cancellation of paired positions (`cancelPairedPosition`).
    - Allows withdrawal of funds from settled positions (`withdrawFromSettled`).
- **`providerNFT`**:
    - Allows liquidity providers to create and update offers (`createOffer`, `updateOfferAmount`).
    - Mints provider position NFTs to the offer provider when an offer is taken.
    - Handles cancellation of provider positions (`cancelAndWithdraw`).
    - Manages withdrawals for settled positions by the NFT owner (`withdrawFromSettled`).

#### Additional Insights: Security and Protocol Assumptions

Several key points emerge from the source code that provide further context:

- **Trust in Taker Contract**: The provider NFT contract trusts the taker NFT contract to manage the taker side of the position and to perform settlement calculations accurately.
- **Security Considerations for Settlement**: The `settlePosition` function in `CollarProviderNFT.sol` is designed to avoid triggering a withdrawal to the provider during settlement to mitigate potential risks, including front-running attacks and complications with NFT markets or escrow contracts.
- **Cancellation Requires Mutual Consent**: Cancellation of a paired position necessitates the caller owning both the taker and provider NFTs, ensuring mutual agreement for the cancellation.

The `takerNFT` and `providerNFT` contracts operate in a tightly integrated manner to facilitate the creation, settlement, and management of Collar positions. They embody the core mechanics of the protocol, ensuring a consistent and secure environment for both takers and providers to participate in the Collar protocol.

Please note that any inferences made about the stability of `cashAsset` and `underlying` are based on common DeFi practices and may not be explicitly stated in the sources. It's recommended to independently verify these assumptions.

### Understanding Loan Creation: A Breakdown of the Code Snippet

This code snippet, found within the `_swapAndMintCollar` function in `combined-src.sol.txt`, is crucial for comprehending how loans are generated within the Collar protocol. It centers around the distribution of cash obtained from swapping the user's collateral (`underlying`) into the borrowed asset (`cashAsset`).

Let's break down the code and its implications step by step:

1. **Splitting the Cash:** The comment `// split the cash to loanAmount and takerLocked` signifies the core action: the `cashFromSwap` (obtained by swapping the user's `underlying` asset for `cashAsset`) is divided into two parts:
    
    - **`loanAmount`**: This represents the actual amount of the loan that the user receives in `cashAsset`.
    - **`takerLocked`**: This is the portion of the swapped cash that is locked in the `takerNFT` contract as part of the Collar position.
2. **LTV and Put Strike Price:** The statement `// this uses LTV === put strike price` highlights a key concept in the protocol's design: the **Loan-to-Value (LTV) ratio** is equivalent to the **put strike price**. In traditional finance, a put option grants the holder the right to sell an asset at a predetermined price (the strike price). In this context, the `loanAmount` can be interpreted as a pre-exercised put option given to the user. The user receives this amount upfront, similar to exercising a put option immediately.
    
3. **Variable Prepaid Forward Structure:** The comment `// in the "Variable Prepaid Forward" (trad-fi) structure` draws a parallel to a financial instrument known as a Variable Prepaid Forward (VPF). In a VPF, a portion of the asset is sold forward at a predetermined price, while the remaining portion's payoff is variable and depends on the asset's price at maturity. Here, the `loanAmount`, analogous to the prepaid portion of the VPF, is fixed and paid to the user upfront. The `takerLocked` portion, coupled with the provider's locked funds in the `providerNFT` contract, contributes to the variable payout at the end of the loan term.
    
4. **Collar Paired Position NFTs:** The statement `// The Collar paired position NFTs // implement the rest of the payout` explains that the remaining payout is determined by the interaction of the paired NFTs representing the taker's and provider's positions. The final payout structure mirrors a **collar options strategy** in traditional finance. A collar involves simultaneously buying a put option and selling a call option on the same asset. This strategy limits both the potential losses and gains within a specified price range. The taker's position is akin to the long put option (limiting losses if the asset price falls), while the provider's position acts as the short call option (limiting gains if the asset price rises).
    

#### Deeper Insights into Loan Creation

This code snippet reveals several important aspects of how loans are structured within the Collar protocol:

- **Prepaid Put Option Analogy:** By equating the LTV with the put strike price, the protocol effectively grants the borrower a pre-exercised put option. This upfront payment of the `loanAmount` provides the borrower with immediate liquidity.
- **VPF-like Payout Structure:** The `takerLocked` portion, combined with the provider's locked funds, creates a variable payout similar to that of a Variable Prepaid Forward. This allows for a more flexible and potentially capital-efficient structure compared to traditional loans.
- **Risk Management via Collar Strategy:** By replicating the payoff of a collar options strategy, the protocol effectively manages the risk for both borrowers and lenders. Borrowers are protected from significant losses if the asset price falls below the put strike price, while lenders are assured a minimum return even if the asset price remains relatively stable.
- **NFT-Based Position Management:** The use of NFTs to represent the taker's and provider's positions facilitates efficient tracking, transfer, and settlement of the Collar positions. It also potentially enables secondary market trading of these positions, although the sources do not provide specifics on this aspect.

This code segment showcases the intricate interplay between traditional financial concepts and blockchain technology, demonstrating the protocol's sophisticated approach to loan origination and risk mitigation.

### The Loan as a Pre-Exercised Put Option

The statement "loan is the pre-exercised put (sent to user)" found in the source code of the Collar protocol (`combined-src.sol.txt`) illuminates a key facet of the protocol's loan mechanism. It elucidates the analogy between the loan provided to the user and the financial concept of a pre-exercised put option.

- A **put option** in traditional finance gives the holder the right, but not the obligation, to sell an underlying asset at a specified price (the strike price) on or before a certain date.
- **Exercising** a put option means the holder is choosing to sell the asset at the strike price.

In the context of the Collar protocol, the loan amount provided to the user is conceptually similar to a pre-exercised put option on the user's collateral (`underlying`). Here's why:

1. **LTV as Put Strike Price:** The protocol sets the Loan-to-Value (LTV) ratio equal to the put strike price. The LTV determines the maximum loan amount a user can receive based on the value of their collateral.
    
2. **Immediate Loan Disbursement:** When a user opens a loan, they immediately receive the `loanAmount` in `cashAsset`. This mirrors exercising a put option upfront: the user essentially "sells" a portion of their collateral at the predetermined strike price (LTV) and receives the cash equivalent.
    
3. **Protection Against Collateral Depreciation:** If the price of the underlying asset falls below the put strike price (LTV) during the loan term, the user is protected from losses exceeding the initial `loanAmount` they received. This is similar to the downside protection provided by a put option.
    

Therefore, by structuring the loan as a pre-exercised put, the protocol provides the user with:

- **Immediate liquidity:** The user receives the loan amount upfront, similar to cashing in a put option.
- **Downside protection:** The user is shielded from substantial losses if the price of their collateral drops significantly.

The remaining portion of the swapped cash (`takerLocked`) is locked in the `takerNFT` contract, and together with the provider's locked funds, contributes to the final payout at the end of the loan term. This mechanism is akin to a Variable Prepaid Forward (VPF), allowing for a flexible payout structure influenced by the asset's price at maturity.

The paired `takerNFT` and `providerNFT` contracts, representing the borrower and lender sides, work in conjunction to determine the final payout, mimicking the payoff structure of a collar options strategy in traditional finance.

### Paired Position NFTs in the Collar Protocol

The sources provide a detailed view of how "paired position NFTs" function within the Collar Protocol, primarily through the `CollarTakerNFT.sol` and `CollarProviderNFT.sol` contracts. These NFTs are central to the protocol's mechanism for creating and managing collar options-like structures, enabling both borrowing and lending activities.

#### Overview of Paired Position NFTs

- **Purpose:** Paired position NFTs represent the two sides of a collar options-like agreement within the Collar Protocol. One NFT is held by the taker (borrower) and the other by the provider (lender), forming a paired position.
- **Function:** These NFTs track the locked assets, strikes prices, duration, and settlement status of the collar position. They govern the final payout mechanism, mirroring the payoff profile of a traditional collar options strategy.
- **Contracts:** The `CollarTakerNFT.sol` contract manages the taker side of the position, while the `CollarProviderNFT.sol` contract handles the provider side. Both contracts interact with each other to execute the creation, settlement, and cancellation of paired positions.

#### Key Features and Functionality

- **NFT Minting:** When a user (taker) wants to open a loan, they interact with the `LoansNFT.sol` contract, which subsequently interacts with the `CollarTakerNFT.sol` and `CollarProviderNFT.sol` contracts to initiate the minting of paired NFTs.
- **Asset Locking:** Upon position creation, the taker locks a portion of the swapped cash (`takerLocked`) in the `takerNFT` contract. Simultaneously, the provider locks a predetermined amount of `cashAsset` in the `providerNFT` contract. These locked amounts, along with the strike prices, determine the final payout.
- **Strike Prices:** The paired position NFTs store the put and call strike percentages, which are established when the provider creates an offer. The put strike price (equivalent to the LTV) protects the borrower from significant losses if the asset price falls, while the call strike price limits the lender's potential gains.
- **Duration:** Each paired position has a predetermined duration, established during offer creation. This duration dictates the timeframe of the collar agreement and when the position can be settled.
- **Settlement:** Upon expiry, the `takerNFT` contract calculates the final payout using oracle prices. The `settlePairedPosition` function in `CollarTakerNFT.sol` determines the final distribution of assets between the taker and provider based on the price movement of the underlying asset relative to the strike prices.
- **Cancellation:** Before expiry, the paired position can be canceled if both the taker and provider agree. This involves burning both NFTs and returning the locked assets to their respective owners.
- **Secondary Market Potential:** Although not explicitly detailed in the sources, the use of NFTs to represent positions suggests the possibility of secondary market trading. This could allow users to transfer or sell their positions before expiry, introducing more flexibility and liquidity to the protocol.

#### Interaction with Other Contracts

The paired position NFTs do not exist in isolation. They heavily interact with other contracts within the Collar Protocol:

- **LoansNFT.sol:** This contract acts as the primary entry point for borrowers, facilitating the opening and closing of loans using the underlying paired position NFTs.
- **EscrowSupplierNFT.sol:** For certain loan types, the `EscrowSupplierNFT.sol` contract is involved, managing escrow positions and interacting with paired positions.
- **Rolls.sol:** This contract enables the extension of existing positions at new prices (rolling) and interacts with paired position NFTs during the settlement and creation of new positions.
- **Oracles:** Multiple oracle options are used to provide price feeds for settlement calculations.

#### Benefits of Using Paired Position NFTs

- **Transparency and Auditability:** The use of NFTs provides a transparent and auditable record of each position's terms and status on the blockchain.
- **Flexibility and Composability:** NFTs can be easily integrated with other DeFi protocols and applications, potentially enabling a wider range of use cases beyond simple borrowing and lending.
- **Potential for Secondary Markets:** NFT-based positions can potentially be traded on secondary markets, offering increased liquidity and flexibility for users.

By leveraging paired position NFTs, the Collar Protocol creates a robust and flexible framework for creating and managing collar options-like structures, enabling efficient borrowing, lending, and risk management within a decentralized environment.

### Breaking Down `calculateProviderLocked` Function

This function, found in `combined-src.sol.txt`, determines the amount of the `cashAsset` that a provider will lock based on the taker's locked amount and the put and call strike percentages. It is integral to ensuring the proper balance of risk and reward in the Collar Protocol's paired position structure.

**Function Breakdown:**

- **Inputs:**
    - `takerLocked`: The amount of `cashAsset` locked by the taker (borrower).
    - `putStrikePercent`: The put strike percentage expressed in basis points (BIPS_BASE). This represents the price level at which the taker is protected from losses.
    - `callStrikePercent`: The call strike percentage expressed in basis points. This sets the ceiling for the provider's (lender's) potential gains.
- **Output:**
    - The function returns the calculated amount of `cashAsset` the provider will lock.

**Calculations:**

1. **Range Calculation:** The code first calculates the `putRange` and `callRange`:
    - `putRange = BIPS_BASE - putStrikePercent`: This represents the price range below the initial price where the taker's losses are capped.
    - `callRange = callStrikePercent - BIPS_BASE`: This indicates the price range above the initial price where the provider's gains are capped.
2. **Proportionality and Scaling:** The provider's locked amount is then determined based on the ratio between these ranges and the `takerLocked` amount:
    - `return takerLocked * callRange / putRange`: This calculation proportionally scales the `takerLocked` amount, reflecting the relative size of the call and put ranges. A wider `callRange` compared to the `putRange` would result in a higher `providerLocked` amount, and vice versa.
    - The code comment notes that this calculation rounds down to prevent potential abuse by takers who might attempt to open small positions to manipulate the ratio.

**Purpose and Significance:**

This function ensures a balanced risk-reward dynamic between the taker and the provider. The amount the provider locks is directly proportional to the taker's locked amount, adjusted by the relationship between the put and call strike percentages. This proportionality ensures fairness and aligns incentives for both parties participating in the collar options-like structure.

**Important Considerations:**

- **Division by Zero:** The code comment highlights a critical safety consideration: "Will div-zero panic for 0 putRange". This indicates that the function will revert if `putStrikePercent` is equal to `BIPS_BASE`, as this would result in division by zero. The comment "cannot be 0 due to range checks in providerNFT and configHub" suggests that the protocol has safeguards in place to prevent this scenario.
- **Range Checks:** The comment "cannot be 0 due to range checks in providerNFT and configHub" indicates that the protocol enforces checks on the input strike percentages to ensure they fall within acceptable ranges. These checks are crucial for maintaining the intended functionality and economic balance of the protocol.

**In Essence:**

The `calculateProviderLocked` function embodies the core principle of balanced risk and reward that underpins the Collar Protocol's paired position structure. By proportionally scaling the provider's locked amount based on the strike percentages and the taker's locked amount, it ensures a fair and equitable distribution of potential gains and losses between both parties involved.

#### About formula: Proportionally Scaling Liquidity Based on Strike Ranges

The formula `takerLocked * callRange / putRange` in `calculateProviderLocked` is used to determine the amount of cash the provider will lock based on the amount the taker locks and the put and call strike percentages. This ensures the provider's locked amount is proportionally scaled according to the put and call ranges.

Here's a breakdown:

- **TakerLocked:** Represents the amount of cash asset locked by the taker.
- **putRange:** Calculated as `BIPS_BASE - putStrikePercent`, representing the range between the starting price and the put strike price.
- **callRange:** Calculated as `callStrikePercent - BIPS_BASE`, representing the range between the call strike price and the starting price.

By multiplying `takerLocked` with `callRange` and dividing by `putRange`, the formula proportionally scales the provider's locked amount to align with the relative sizes of the put and call ranges. This approach ensures a balanced distribution of risk and potential rewards between the taker and provider, reflecting the asymmetry inherent in a collar option structure.
#### Examples of How `calculateProviderLocked` Works

Let's look at some specific examples to illustrate how `calculateProviderLocked` works:

**Example 1: Symmetric Strike Percentages**

- Taker Locked: 1000 USDC
- Put Strike Percent: 90%
- Call Strike Percent: 110%

In this scenario, the put and call ranges are symmetrical:

- putRange = 100% - 90% = 10%
- callRange = 110% - 100% = 10%

The formula `takerLocked * callRange / putRange` would result in:

- Provider Locked: 1000 * 10% / 10% = **1000 USDC**

Since the strike ranges are symmetrical, the provider locks the same amount as the taker.

**Example 2: Asymmetric Strike Percentages**

- Taker Locked: 1000 USDC
- Put Strike Percent: 80%
- Call Strike Percent: 110%

Here, the put range is wider than the call range:

- putRange = 100% - 80% = 20%
- callRange = 110% - 100% = 10%

Using the formula:

- Provider Locked: 1000 * 10% / 20% = **500 USDC**

The provider locks a smaller amount compared to the taker, reflecting the wider put range and the provider's reduced downside risk.

**Example 3: Wider Call Range**

- Taker Locked: 1000 USDC
- Put Strike Percent: 90%
- Call Strike Percent: 120%

Now, the call range is wider than the put range:

- putRange = 100% - 90% = 10%
- callRange = 120% - 100% = 20%

The calculation yields:

- Provider Locked: 1000 * 20% / 10% = **2000 USDC**

The provider locks a larger amount than the taker due to the wider call range and increased upside potential.

These examples highlight how `calculateProviderLocked` dynamically adjusts the provider's locked cash based on the relative sizes of the put and call ranges. This ensures a balanced distribution of risk and potential rewards for both parties involved in the collar option structure.

### Put Strike Percent as Loan-to-Value (LTV)

The sources indicate that in this specific implementation, the put strike percent is always assumed to be equivalent to the Loan-to-Value (LTV) ratio. The code comment in `_swapAndMintPaired` explicitly states that "this uses LTV === put strike price". This design choice links the loan amount directly to the pre-exercised put option, creating a structure similar to a "Variable Prepaid Forward" in traditional finance.

This means that the loan amount is determined by the put strike percentage applied to the cash obtained from the swap. The remaining cash, after deducting the loan amount, becomes the `takerLocked` portion of the collar position. This connection between put strike percent and LTV simplifies the structure and ensures the loan amount reflects the protected value provided by the put option.

While the sources don't explain why this design choice was made, it's worth noting that equating LTV and put strike percent streamlines the system and directly ties the loan amount to the downside protection mechanism. This approach might be suitable for specific use cases, but it might not be appropriate for all scenarios where a more flexible relationship between LTV and put strike might be desired.

It's important to remember that this information is based on the provided sources. You might want to explore additional resources or consult with experts in the field to understand the potential implications and limitations of this specific implementation.

### The `protocolFeeAPR`

The `protocolFeeAPR` is a configuration parameter that determines the annual percentage rate (APR) charged by the protocol as a fee for facilitating collar options. This fee is applied on top of the provider's locked amount, and it is deducted from the offer when a position is created. The fee is calculated based on the provider's locked amount and the duration of the collar option.

The `protocolFeeAPR` is set by the protocol owner using the `setProtocolFeeParams` function in the `ConfigHub` contract. The owner can set the `protocolFeeAPR` to any value up to `MAX_PROTOCOL_FEE_BIPS`, which is 1% in the provided code. The owner can also specify a `feeRecipient` address, which will receive the collected fees. If the `protocolFeeAPR` is set to zero, the `feeRecipient` can be set to the zero address, effectively disabling the fee.

The `protocolFee` is calculated in the `protocolFee` function of the `CollarProviderNFT` contract. This function takes the `providerLocked` amount and the `duration` of the collar option as input. It then uses the following formula to calculate the fee:

```
fee = to == address(0)
    ? 0
    // rounds up to prevent avoiding fee using many small positions.
    : Math.ceilDiv(providerLocked * configHub.protocolFeeAPR() * duration, BIPS_BASE * YEAR);
```

The fee is then deducted from the offer amount, and the remaining amount is used to create the collar option.

The tests in the sources include several examples of how the `protocolFeeAPR` is used and how the fee is calculated. For example, in `test_protocolFee_nonDefaultValues`, the `protocolFeeAPR` is set to 50 basis points (0.5% per year). Then, the `protocolFee` function is called with a `providerLocked` amount of 10 ether and a duration of 365 days. The calculated fee is 0.5 ether, which is 0.5% of 10 ether.

### Why Automatic Withdrawals to Providers are Undesirable in the `settlePosition` Function

- **Provider as a Contract:** If the provider is a smart contract, it may have its own internal accounting and fund management mechanisms. Directly transferring funds could disrupt these processes.
- **NFT Traded in Marketplaces or Escrows:** If the provider's NFT is being traded on an NFT marketplace or held in an escrow contract, those contracts are not designed to handle incoming settlement funds directly. This could lead to the loss of funds or operational errors.
- **Provider Control Over Withdrawal:** Providers may have preferences regarding the timing and destination of their withdrawals. For example, they might wish to withdraw at a specific price point or send funds to a different address. Automatic withdrawals would remove this flexibility.
- **Front-Running Vulnerability:** In the case of NFTs traded on marketplaces, allowing immediate withdrawal upon settlement could create a front-running opportunity. An attacker could monitor for settlement transactions, then quickly buy the NFT at a lower price before the provider can withdraw their funds.
- **Burning NFT to Prevent Front-Running:** To prevent front-running during withdrawal, the NFT must be burned. This ensures that the value of the NFT does not change abruptly and prevents attackers from exploiting price discrepancies.

The design of the `settlePosition` function avoids these risks by only transferring funds between the `CollarProviderNFT` and `CollarTakerNFT` contracts during settlement. The provider can then initiate a separate withdrawal transaction at their discretion, which will burn the NFT and transfer the withdrawable funds to their specified address.