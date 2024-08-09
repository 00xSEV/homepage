---
title: Deep dive into MakerDAO Endgame
---
## Lockstake
### Terms
- `nDAI` -- normalized DAI == `art`
- `<- X` -- called by a user/external entity
### What is Lockstake? 
-- Lock MKR to farm, vote, and use as collateral. 15% fee on withdrawal
    - https://endgame.makerdao.com/tokenomics/sagittarius-engine
### LockstakeClipper
- Qs
  - What is LockstakeClipper? -- Modified clipper, called by Dog (.bark)
	- [README for contest](https://github.com/makerdao/sherlock-contest/blob/9a01337e8f82acdf699a5c1c54233636c640ca89/README.md#lockstake)
	- Is it in scope or only diff? -- Most of the issues OOS, only diff:
	  - https://security.makerdao.com/liquidations-2.0
	  - Everything from the original [clipper](https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/clip.sol)
	- Readme inside repo (lockstake/README.md)
	  - [proxy-manager-clipper](https://github.com/makerdao/proxy-manager-clipper/blob/67b7b5661c01bb09d771803a2be48f0455cd3bd3/src/ProxyManagerClipper.sol) -- auctions for situations when collateral is deposited somewhere (e.g., compound)
		- https://forum.makerdao.com/t/mip59-dsscharter/10028
	  - (used for [dss-crop-join](https://github.com/makerdao/dss-crop-join)). -- allows depositing collateral somewhere to get profit
		- DSS-Crop-join introduces support for new ilks with a join adapter facilitating the staking of the collateral tokens in a third-party system to generate rewards instead of simply holding the tokens at the join adapter. The generated reward is distributed amongst the users the collateral belongs to.
		- https://www.chainsecurity.com/security-audit/makerdao-dss-crop-join
		- https://forum.makerdao.com/t/mip30-farmable-cusdc-adapter-cropjoin/5163
  - What did they even change? -- flux => slip, engine callbacks. Probably LSE will handle collateral after it is slipped (just change the gem amount)
	- Check diff
	  - flux vs slip -- move vs just update
		- vat.flux -- move gem (internal collateral balance) to another account. Checks for msg.sender or approved ^vat-flux
		- vat.slip -- just change gem (free collateral, not yet in any urn) balance, nothing else, authed ^vat-slip
	  - engine callbacks
  - Readme inside repo further
	- "sends the taker callee the collateral (MKR) in the form of ERC20 tokens and not `vat.gem`" What does it mean? -- Sends collateral to liquidator
	  - taker callee -- liquidator selects where to send collateral, taker=liquidator, callee=where(address)
	  - ERC20 vs vat.gem implications -- Probably just for convenience, no need to exit .gem to ERC20
	- exit fee -- 15% paid when withdrawing MKR (collateral)
	- "MKR (collateral) leftovers upon completion of the auction" -- dent phase can leave more collateral in an urn
	  - why and when is it left? -- Because of the `dent` phase
		- does it use the same auction as original DSS? -- Mostly yes, so first increase the DAI paid, then decrease collateral
		- do they sell 100% of collateral or what -- Same
	  - Is auction not for 100% of collateral -- According to [docs](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#vault-liquidation) 100%, dog.bark 
	- "incentives for self-liquidation" which ones? -- Probably exit fee avoidance (but not sure if it's kept or not, see [[#^LSC--1-fee|1-fee]]), but maybe also to socialize bad debt, get rewards from protocol
	- ilk's liquidation ratio (`mat`) -- lower => can liquidate ^spot-ilk-mat
	  - how is it stored? -- 1.45e27
		- get mkr contract, spot?
		  - https://chainlog.makerdao.com/
			- spot https://etherscan.io/address/0x65c79fcb50ca1594b025960e539ed7a9a6d434a3#readContract#F1
			  - ETH 0x4554482d41000000000000000000000000000000000000000000000000000000 => 1.45 e27
			- ilk registry .list https://etherscan.io/address/0x5a464c28d19848f44199d003bef5ecc87d090f87#readContract#F11
	- `ink * price / mat = debt` -- 'collateral in ~USD scaled down by liquidation ratio = debt' is the limit, or debt scaled up by `mat` should be <= collateral
	- chop -- penalty in %, like 1.13
	- amt of collateral sold `debt * chop / price` -- debt in USD + fee in collateral tokens
	  - In which tokens is debt -- ~USD
	  - then why do we divide on price -- to get collateral amt
	- "Since we need to make sure that only up to `(1-fee)` of the total collateral is sold (where `fee` will typically be 15%), we require: `② debt * chop / price < (1-fee) * ink`" ^LSC--1-fee
	  - Why (1-fee)? -- We need to keep the fee for the protocol, can't sell all the collateral? hmm
		- Where does the fee go? We just keep it on the protocol or can give to a liquidator too? --  [[#^LSC-take]] calls [[#^LSE-onRemove]], which seem to burn MKR `fee`
		- Why don't we send the fee somewhere on deposit if it's not a reward for liquidation? -- It's for an auction, but because of overcollateralization it will be probably left
		- Oh, `fee` is the Maker term here? -- Kind of, it's just exit fee, but also a `fee` variable
	  - `debt * chop / price < (1-fee) * ink` -- debt + liquidator premium < collateral available
		- Explanation: debt + liquidator premium < collateral available (without exit fee) (all in ~MKR) 
		  - debt -- debt in ~USD
		  - chop -- liquidator premium
		  - `debt * chop / price` -- debt + premium in collateral (~MKR)
		  - `(1-fee) * ink` -- collateral left after 15% fee
	- `mat > chop / (1 - fee)` -- mat covers both (liquidator bonus) * (exit fee)
	  - -->  > 1.18 * 1.13  (1/0.85 ~ 1.18)
	  - -->  > debt + (exit fee) + (liquidator bonus) 
	  - 1. Because debt limit is collateral scaled down by LTV
	  - 2. And debt + liquidator fee must be < collateral available
	  - chop -- liquidator bonus
	  - `chop / (1 - fee)` -- liquidator bonus * 1.18
	- `chip` - Percentage of tab to suck from vow to incentivize keepers. -- how much DAI to mint to keeper at the expense of vow (the system)
	  - tab -- DAI wanted from auction, DAI debt
	  - suck -- vat.suck: add the bad debt (in DAI) on u, give the same DAI to v ^vat-suck
		- Define -- add bad debt to u, mint `dai` to v, increase total bad debt and total `dai` 
		  - sin -- `[address => bad debt DAI]`
		  - dai -- `[address => balanceOf DAI]`
		  - vice -- total sin, total bad debt DAI
			- sin vs vice -- [] vs [].sum()
		  - debt -- dai.sum()
	  - vow -- debt and surplus counter
  - How does lsmkr move? ^Q--lsmkr-move
	- Where is it minted, and to whom:
	  - `LSE._lock`; -- to `urn`, user provided LSUrn, created by LSE
		- > `urn` must have `urnOwners[urn]` that is set only on LSE.open => `urn` is LockstakeUrn
		- LSE.lock <-X
		- LSE.lockNgt <-X
	  - LSE.onRemove; -- to liquidated `urn`
		- LSC.take <- X; to: liquidated `urn`
		  - to: `sales[id].usr`, id is `take`r provided ^Q--lsmkr-move--to-usr
			- `sales[id].usr` set on LSC.kick 
			  - called by dog.bark
				- `urn`, provided by caller/liquidator, liquidated `urn`
		  - Can we change .usr? -- no
			- Can we call .bark for the same urn? -- nope, id is ++ on each kick
			  - If price goes down again? -- nope, id = kick++
			- others -- no other changes
		- LSC.yank <- END.sol; to: same as in `take`, liquidated `urn`
	- Where is it burned and to whom:
	  - `LSE._free`; -- to: urn, user provided, but uses [[#^LSE-urnAuth]]
		- free
		- freeNgt
		- freeNoFee
	  - LSE.onKick: -- to: liquidated `urn`
		- LSC.kick
		  - to: same as [[#^Q--lsmkr-move--to-usr]]
	- Where is it approved and to whom
	  - LSUrn.init; -- to: LSE; amt: max
		- lsmkr.approve(msg.sender, type(uint256).max);
		  - who is msg.sender? -- LSE on LSE.open
	  - LSUrn.stake; -- to: user-selected `farm`, but gov approved; amt: all ink(MKR, collateral) on `urn`; or newly transferred MKR
		- `LSE._selectFarm`
		  - user provided, but from gov approved
		- `LSE._lock`
		  - to the same selected farm, additional funds
		- Approves using lsmkr.approve(farm, wad);
	- Where is it moved/transferred? -- only on farm, but it can only be called by LSUrn => LSE
	  - from LSUrn -- no lsMkr transfers
	  - by LSE -- no lsMkr transfers
	  - by farm -- safeTransfer from/to msg.sender
	  - possible to farm on some other address, then can withdraw some lsMKR?-- no, only on msg.sender
	- Can the user transfer/burn it or is it stored somewhere? -- it is stored on LSUrn or SR, that does not allow transfers or approvals (unless ...)
	- If we can move or burn lsMkr -- does not seem that we can
	  - [x] something will revert because it expects urn to have it?
		- [x] probably `take`
		- [x] other functions that burn/transfer
	- [[#^LSE--lsMkr-flow]]
- kick -- start an auction, withdraw MKR to LSE ^LSC-kick
    - Qs
      - "trusts the caller to transfer collateral to the contract", where does it happen? -- in dog.bark using vat.grab ^LSC-kick-Q-transfer
        - caller -- dog.bark
        - does dog.bark do it? -- yep
          - vat.grab? -- urn.ink(collateral) => `vat.gem[clip]`; urn.debtDai => vow; ^dog-bark--vat-grab
            - move user's (urn) collateral(gem) to clip(LSClipper) and DAI debt to system (vow); 
            - reduce urn's collateral and DAI debt, increase vow's surplus and bad debt in DAI
            - dog.bark pass args:
              - milk.clip -- auction address for this collateral
                - milk -- memory collateral struct
                - clip -- clipper(auction) address
              - vow -- debt/surplus ledger
              - dink -- diff collateral balance
              - dart -- diff normalized DAI balance (no rate applied yet, so not a real balance)
            - ink -- collateral balance of an urn
            - dtab -- DAI wanted from auction
            - gem -- free collateral tokens
              - vat.gem vs urn.ink -- free collateral with locked in urn
            - sin -- `[address => bad debt DAI]`
            - vice -- total sin, total bad debt DAI
    - args
      - tab -- auction wanted total in DAI (usually the whole urn's debt) + penalty ^kick-tab
        - what? -- auction total in DAI (1e45) + penalty
          - Qs
            - "total dai wanted from the auction / total dai to be raised (in flip auction)"? -- so we replaced flip auctions with clip auctions and it looks like a clip auction
            - why "Debt" in comments? 
              - so we sell collateral (ETH) to cover debt (DAI). Probably how much debt we are ready to cover
          - how is it set in dog.bark -- DAI to liquidate + penalty ^dog--tab
            - `mul(due, milk.chop) / WAD;` -- DAI to liquidate + penalty
              - due = `mul(dart, rate);` -- DAI to liquidate
                - dart -- nDAI to liquidate (whole urn or system max) ^dog-bark--dart
                  - `dart1 = min(art, mul(room, WAD) / rate / milk.chop)` -- min(nDAI in urn, max nDAI allowed)
                    - art -- nDAI of an urn being liquidated
                      - vat.urns(ilk, urn);
                    - room/rate/chop -- max system limit of nDAI - liquidation penalty
                      - room -- how much DAI is allowed to be auctioned (hole-dirt)
                        - `min(Hole - Dirt, milk.hole - milk.dirt)` ^dog-hole-and-dirt
                          - milk.hole -- max DAI in auctions per collateral
                          - milk.dirt -- current DAI in auctions per collateral
                          - [Hole](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#dog-hole-rad) -- max DAI in auctions total
                            - Dog.Hole -- [docs](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#setting-hole-or-ilk.hole-too-high)Max DAI needed to cover debt + liquidation penalty of active auctions. `Hole = 10,000,000 * RAD` is 10M DAI.
                            - ilk.hole -- [docs](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#setting-hole-or-ilk.hole-too-high) Max DAI needed to cover debt + liquidation penalty of active auctions per collateral (`ilk`).
                        - [Dirt](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#limits-on-dai-needed-to-cover-debt-and-fees-of-active-auctions) -- current DAI in auctions total
                          - ChatGPT -- all bad debt
                          - https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#limits-on-dai-needed-to-cover-debt-and-fees-of-active-auctions
                            - `box` -- gpt: max Dai debt in the system
                          - https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#partial-vs.-total-liquidations
                            - `dunk` -- set by governance, min amount of debt DAI to liquidate (either it or all vault's debt)
                              - minimum DAI liquidity requirement
                              - art -- normalized DAI debt 
                                - (normalized outstanding stablecoin debt.)
                            - `dunk` not used in Dog, can partially liquidate 
                      - rate -- multiplier to get DAI from art (nDAI)
                        - `(,rate, spot,, dust) = vat.ilks(ilk);`
                      - milk.chop -- liquidation penalty, e.g. 1.13
                - if (art > dart) -- not a full liquidation
                - `if (mul(art - dart, rate) < dust)` -- if DAI left < dust
                  - art - dart1 -- nDAI that can't be liquidated because of system limits
                  - rate -- nDAI to DAI conversion rate
                - `dart = art` -- if dust left add the dust. So Hole, .hole are not strict limits
              - rate -- nDAI to DAI converter
            - milk.chop -- liquidation penalty, e.g. 1.13. Profit for keeper and Vow
              - Goes to maker? Check code -- probably goes to vow, see [[#^milk-chop--does-go-to-maker]]
                - gpt: goes to keeper incentives, surplus goes to vow
                - it goes to `kick` in `tab`, so not sure
      - lot -- collateral amount proportional to tab, usually both 100% ^kick-lot
        - How is it set in dog.bark? -- usually 100%. proportional to nDAI debt amt liquidatable (hole - dirt) ^dog-bark--dink
          - `dink = mul(ink, dart) / art` = ink * dart / art = collateral proportional to liquidated nDAI amount. Usually all
            - ink -- collateral balance of an urn
            - dart -- DAI to liquidate (whole urn or system max) [[#^dog-bark--dart]]
            - art -- nDAI debt in the urn
        - How do we synchronize it with tab amount? Do we need to do it? Or is it a first bid -- in dog.bark
      - usr -- liquidated urn
      - kpr -- keeper address, where liquidation reward (coin) will be sent
        - [[#^vat-suck]] -- mint DAI to kpr from vow (create vow debt) ^LSC-kick--vat-suck


        - `coin = _tip + wmul(tab, _chip)` -- liquidator reward: flat fee + % ^LSC-kick--coin
          - `_tip` -- flat fee to `suck` from `vow` as a reward to liquidator/resetter ^LSC-kick--tip
            - [`tip`](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#clipper-tip-rad)
          - tab -- auction total in DAI
            - [[#^kick-tab]]
          - `_chip` -- percentage to `suck` from `vow` as a reward to liquidator/resetter ^LSC-kick--chip
            - [chip](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#clipper-chip-wad)
    - body
      - active.push(id); -- stores active auction ids ^LSC-kick--active-push
      - sales -- active auction {id => struct} ^LSC--sales
        - pos; -- Index in `active` array
        - tab; -- auction total [[#^kick-tab]] 
          - Dai to raise from the auction `[rad]`, 
        - lot; --  [[#^kick-lot]]
          - // collateral to sell `[wad]`
        - tot; -- ~immutable lot at the auction start, to calculate how much was sold for `onRemove`
          - // static registry of total collateral to sell `[wad]`
          - where is it used? -- only onRemove to get how much was sold
        - usr; -- Liquidated CDP (urn)
        - tic; -- Auction start time
        - top; -- starting auction price in DAI, above market by `*buf` ^LSC--sales--top
          - Comment on top of kick 
            - val -- collateral value in UoV (~USD) ^LSC-getFeedPrice
              - getFeedPrice -- DAI per asset ^spotter
                - spotter -- ~oracle registry, with a delay. Return pip (oracle) by ilk (collateral type)
                  - calls vat.file on [poke](https://docs.makerdao.com/smart-contract-modules/core-module/spot-detailed-documentation#poke)
                    - has some calculations for `spot` (vat.file(ilk, "spot", spot))
                      - [spot.poke](https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/spot.sol#L98-L103)
                      - [vat.file](https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/vat.sol#L111)
                      - [docs](https://docs.makerdao.com/other-documentation/system-glossary#vat-vault-engine) "collateral price with safety margin, i.e. the maximum stablecoin allowed per unit of collateral."
                  - [docs](https://docs.makerdao.com/smart-contract-modules/core-module/spot-detailed-documentation)
                - pip -- oracle
                - pip.peek -- get price [[#^pip-peek]]
                - `rdiv(uint256(val) * BLN, spotter.par())` -- val/par; convert UoV from oracle to DAI, e.g. 20EUR/asset => 25DAI/asset. 
                  - val / par
                  - BLN -- 1e9, billion
                  - spotter.par -- UoV/DAI, e.g. 0.8EUR/ DAI. 
                    - val (in EUR) / 0.8 = 1.25 => 1 EUR = 1.25 DAI
            - buf -- multiplier to increase the starting price above market
              - because it's auction that goes down we want to start higher than market, so we multiply
              - how is it set -- gov or trusted
            - par -- only in [[#^LSC-getFeedPrice]], Unit of Value / DAI, e.g. 0.8EUR/ DAI ^LSC--sales--top--par
          - `rmul(getFeedPrice(), buf)` -- collateral price in DAI * buffer above market, e.g. 1.2
          - Where is it used?
            - redo
            - take
            - getStatus
            - status
      - if has reward ^LSC-kick--hasReward
        - tip -- flat reward for keeper [[#^LSC-kick--tip]]
        - chip -- % reward for keeper [[#^LSC-kick--chip]]
        - `coin = _tip + wmul(tab, _chip)` -- liquidator reward [[#^LSC-kick--coin]]
        - vat.suck(vow, kpr, coin); -- mint DAI to kpr from vow (create vow debt) [[#^LSC-kick--vat-suck]] 
      - engine.onKick(usr=urn, lot) -- withdraw MKR to LSE, lsMKR to LSUrn => burn this lsMKR ^LSE-onKick
        - > Undelegate and unstake the entire `urn`'s MKR amount. Users need to manually delegate and stake again if there are leftovers after liquidation finishes. (Readme)
        - `inkBeforeKick = ink + wad` -- collateral of urn before liquidation (dog.bark)
          - ink -- collateral balance of an urn
          - wad = lot -- collateral amount on the auction [[#^kick-lot]]
          - Qs
            - Why do we add? Do we subtract from the urn on kick or dog.bark? -- yes, dog.bark using vat.grab transfer urn debt and collateral to vow [[#^LSC-kick-Q-transfer]]
        - `_selectVoteDelegate(urn, inkBeforeKick, urnVoteDelegates[urn], address(0));` -- here: withdraw urn's pre-liquidation collateral balance(MKR) from delegate, remove delegate ^LSE-onKick--i-selectVoteDelegate
          - `_selectVoteDelegate` -- here: withdraw wad MKR from the VoteDelegate to LockstakeEngine, remove urn's VoteDelegate 
            - `VoteDelegateLike(prevVoteDelegate).free(wad);` -- return wad MKR to LockstakeEngine [[#^VD-free]]
          - `urnVoteDelegates[urn]` -- urn => delegatedVotesTo mapping
          - why address(0) -- we don't want to redelegate, new delegate is address(0)
        - `_selectFarm(urn, inkBeforeKick, urnFarms[urn], address(0), 0)` -- here: withdraw urn's pre-liquidation collateral balance(MKR) from farm, remove farm ^LSE-onKick--i-selectFarm
          - `_selectFarm(address urn, uint256 wad, address prevFarm, address farm, uint16 ref)` [[#^LSE-i-selectFarm]]
        - Can MKR be both delegated and staked? But how? -- minting lsMKR 1:1, stake it ^LSE-lockMkrTwice
        - lock -- deposit MKR to LSE; mint lsMKR to LSUrn; optionally delegate(move) MKR, stake lsMKR [[#^LSE-lock]]
        - lsmkr.burn -- just burn lsMKR
        - `urnAuctions[urn]++` -- used to disallow `selectVoteDelegate` and `selectFarm` when auctions are active ^LSE--urnAuctions
          - onKick ++
          - onRemove --
- take ^LSC-take
    - Comment
      - Buy using what -- DAI, we buy collateral, paying DAI debt
      - Who supplies amt -- taker (user)
      - "if `amt` would cost more DAI than `tab` at the current price, the amount of collateral purchased will instead be just enough to collect `tab` DAI". ^LSC--C-owe-down
        - => if request too much `amt` will be limited to `tab` converted to collateral amount
          - if `amt` (requested collateral amount) would cost more DAI than `tab` (all debt + penalty), the amount of collateral purchased will instead be just enough to collect `tab`(debt + penalty all) DAI 
        - why "`tab` at the current price", isn't tab already set on kick -- tab can decrease when some collateral is bought + decrease with time
        - amt in MKR, taker(user) provided; 
        - tab in DAI - auction total, usually the whole urn, if not too many auctions; 
        - chost = (Vat.dust * Dog.chop(ilk) / WAD) -- min value left = dust + penalty ^LSC--chost
          - vat.dust -- min debt to leave [docs](https://docs.makerdao.com/other-documentation/system-glossary#vat-vault-engine)
          - dog.chop -- penalty (per collateral, e.g. 1.13) [docs](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#dog-ilk.chop-wad)
      - "Purchase amounts will be minimally decreased when necessary to respect this limit; i.e., if the specified `amt` would leave `tab < chost` but `tab > 0`, the amount actually purchased will be such that `tab == chost`." -- if `take` will leave less than allowed dust, then we decrease take `amt` ^LSC--C-owe-up
      - "If `tab <= chost`, partial purchases are no longer possible; that is, the remaining collateral can only be purchased entirely, or not at all." -- if dust left can only `take` all ^LSC-take--tab-le-chost
    - args
      - id -- auctionId, set in [[#^LSC-kick|kick]]
      - amt -- user provided limit in MKR (collateral) to buy
        - Why do we need it, isn't all the collateral for sale? -- Can buy a part of collateral using the price, the rest will continue to be sold with decreasing price [docs clipper](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#example-liquidation) 
      - max -- DAI/collateral
      - who -- where to send bought MKR
      - data -- passed to who
    - body 
      - [[#^LSC--sales]] 
        - ![[#^LSC--sales]]
      - in which case usr(urn) == address(0)? -- isAuctionExist: set to 0 by `_remove`(After auction finished); And 0 by default, before kick is called. ^LSC-take--usr-addr0
        - => after [[#^LSC-take]] (if no collateral or debt left)
        - => [[#^LSC-yank]] (cancel during End) 
      - `(done, price) = status(tic, sales[id].top)` -- return: should `redo` the auction?; New price (depends on time) ^LSC-status
        - args: starting time and price
        - calc.price(top, block.timestamp - tic) -- return new price, provided start price and time since start
          - initial price, seconds since start => current auction price
          - calc -- basically just return price on time, using e.g., LinearDecrease, see [abaci.sol](https://github.com/makerdao/dss/blob/master/src/abaci.sol)
        - `done = (block.timestamp - tic > tail || rdiv(price, top) < cusp)`  -- auction time and collateral market price drop are not too high
          - `block.timestamp - tic > tail` -- auction duration < max allowed
            - tail -- max auction duration, after it must redo(reset)
              - [docs](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#clipper-tail-seconds) [docs2](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#resetting-an-auction)
          - `rdiv(price, top) < cusp` -- collateral price decrease is less than max allowed
            - current price / start price < allowed
            - cusp -- max price change before must reset
      - owe -- DAI to pay; 
        - TLDR: scaled down to tab (all debt in DAI); or add `chost`; see [[#^LSC--C-owe-down]] [[#^LSC--C-owe-up]]
        - // DAI needed to buy a slice of this sale
        - slice -- collateral amount to buy; either all collateral or taker provided value
        - owe1 -- collateral amount that will be bought in this take, in DAI
          - price in which currency? -- DAI
        - if (owe1 > tab) { -- collateral price proposed by the auction increased for some reason (unusual, because it always decreases in Dutch auction)
          - How is it possible -- ok, maybe if a calc is complicated and cannot only decrease, but also increase price, idk. Don't see in usual case
            - tab -- set on auction `kick`, can only decrease on each `take`
            - owe -- depends on `price`, which only decrease with time
            - [docs](https://docs.makerdao.com/smart-contract-modules/dog-and-clipper-detailed-documentation#clipper.take-performs-several-initial-checks)
        - owe1 < tab && slice < lot -- price decreased and not buying all collateral
          - normal case, price decreased. But also don't buy all collateral
          - `if (tab - owe < _chost)` -- DAI to raise after this `take` less than `dust`
        - `owe == tab` why nothing? -- if raise exactly as we want, then all good
      - slice -- collateral amount to receive;
      - `vat.slip(ilk, address(this), -int256(slice))` -- reduce gem (free collateral) by amount `take`n
        - why address(this)? Did we get `gem` in `kick`? -- almost, in dog.bark
          - we had MKR on engine after `kick`, so `onTake` is understandable
          - dog.bark? -- yep, [[#^LSC-kick-Q-transfer]]
        - ![[#^vat-slip]]
      - `engine.onTake(usr, who, slice)` -- just move MKR from LSE to who ^LSE-onTake
        - How did we get MKR to LSE -- part from LSE.onKick from voteDelegate, all of it on LSE.lock
          - Part from [[#^LSE-onKick|`LSE.onKick`]], but only delegated
            - Where did we get the rest? -- on LSE.lock
          - gem added to LSClip on dog.bark always
          - how do we put MKR in urn?
            - LSE.open + LSE.lock
      - vat.move -- transfer DAI from, to, amt ^vat-move
      - dog_.digs(ilk, lot == 0 ? tab + owe : owe) -- reduce DAI in auctions; by `owe`; If no collateral left reduce also by tab (DAI left to pay)
        - dog.digs -- reduce DAI in auctions by rad passed ^dog-digs
          - Dirt -- total DAI in auctions [[#^dog-hole-and-dirt]]
          - ilk.dirt -- total DAI in auctions for collateral
          - [dog.digs gh](https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/dog.sol#L239-L243)
        - when lot == 0 -- collateral left to sell after this `take` == 0
        - why tab + owe -- in case no collateral left taker needs to pay all the DAI requested, otherwise only owe
          - tab -- DAI left to pay
          - owe -- DAI paid here
      - `if (lot == 0) {` -- no collateral left
        - engine.onRemove(usr, tot, 0) -- burn fee (in MKR); refund MKR, lsMKR; `urnAuctions[urn]--`; -- ^LSE-onRemove
          - burn fee (if collateral left); refund MKR to `urn`; mint lsMKR to `urn` (1:1 as MKR refund); reduce the number of auctions for urn 
          - 1)) in `if (left > 0) {`
            - burn -- grossed up fee; in collateral (MKR); no more than `left` (collateral left in auction)
              - "Burn a proportional amount of the MKR which was bought in the auction and return the rest to the `urn`." (from lockstake/README.md)
              - sold * fee / (WAD - fee) -- `fee` is [grossed-up](https://www.investopedia.com/terms/g/gross-up.asp)
                - why `WAD - fee`? -- like taxes, `sold` is post-tax. gross-up
                  - I remember I read about this formula somewhere
                    - Gross-up amount = desired net pay / (1 – Tax Rate)
                    - lockstake/README.md "Exit Fee on Liquidation" [[#^LSC--1-fee]]
                    - how is fee set -- to a value < WAD
                    - what is WAD here, 1? -- yep, at least for fee
                    - let's say we sold 50%
                      - 0.5 * 0.15 / 0.85 = ~0.088 (burn)
                      - left 0.5
                      - refund 0.5 - 0.088 = 0.412
                    - I think it's like a tax, to get to $10k salary post-tax with 15% tax you need to have 10k * 0.15 / 1 - 0.15 = ~`$1.765k` more pre-tax. 11765 - 15% = ~10k
              - mkr.burn straightforward burn? -- yep, just checks for approval or msg.sender == from
                - is it old mkr or new? -- old
                  - see mkr = mkrNgt.mkr(); in LSE.constractor
                - check the MKR old code -- more or less straightforward
                  - [docs](https://docs.makerdao.com/smart-contract-modules/mkr-module) => [github](https://github.com/dapphub/ds-token/blob/master/src/token.sol)
                  - auth -- allows calling `burn` for anyone rn, but can be changed in theory


                    - msg.sender in modifier in public => msg.sender in modifier in internal
                      - authority is set, so we go to the last line 
                        ```solidity
                        function isAuthorized(address src, bytes4 sig) internal view returns (bool) {
                                if (src == address(this)) {
                                    return true;
                                } else if (src == owner) {
                                    return true;
                                } else if (authority == DSAuthority(address(0))) {
                                    return false;
                                } else {
                                    return authority.canCall(src, address(this), sig);
                                }
                            }
                        ```
                      - it looks like it can only be called by admin? -- no, see [auth.sol](https://github.com/dapphub/ds-auth/blob/a51e7caa1f03eeffed66d67f3b38605e0f1f881d/src/auth.sol). Either owner or `authority.canCall(src, address(this), sig)` which allows calling `burn` to everyone
                        - DSAuthority? 
                          - On mainnet it's [MKRAuthority](https://github.com/makerdao/mkr-authority/blob/master/src/MkrAuthority.sol) see [etherscan MKR](https://etherscan.io/address/0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2#readContract#F8)
                          - It allows calling burn!
                            ```solidity
                            function canCall(address src, address, bytes4 sig)
                                  public view returns (bool)
                              {
                                if (sig == burn || sig == burnFrom || src == root) {
                                  return true;
                                } else if (sig == mint) {
                                  return (wards[src] == 1);
                                } else {
                                  return false;
                                }
                              }
                            ```
                      - burn external (msg.sender == 1) => burn public(internal) (msg.sender == 1) => auth (internal) (msg.sender == 1)
                        - code (same msg.sender everywhere)
                          ```solidity
                          // SPDX-License-Identifier: MIT
                          pragma solidity ^0.8.0;
                          
                          import "hardhat/console.sol";
                          
                          contract SimpleBurnTest {
                              modifier auth {
                                  console.log("msg.sender in auth modifier:", msg.sender);
                                  _;
                              }
                          
                              function burn(uint256 amount) external {
                                  console.log("External burn function called by:", msg.sender);
                                  _burn(msg.sender, amount);
                              }
                          
                              function _burn(address guy, uint256 amount) public auth {
                                  console.log("Internal _burn function called with guy:", guy);
                                  console.log("msg.sender in _burn function:", msg.sender);
                                  // Burn logic would go here, but we're omitting it for this test
                              }
                          }
                          ```
              - slip+frob -- `increase vat.urns[LSUrn].ink` on `refund` ^LSE-onRemove--slip-plus-frob
                - vat.slip(ilk, urn, int256(refund)) -- increase `urn`'s `gem`(free collateral) on `refund`(returned to the `urn` after liquidation)
                  - increase gem [[#^vat-slip]]
                - vat.frob(ilk, urn, urn, address(0), int256(refund), 0); -- move collateral (MKR) from `address urn`'s `vat.gem` (free collateral) to an `address urn`'s `vat.urns` (vault) [[#^LSC-kick--vat-frob]]
                  - How did we get the `gem` for the `urn`? Why it's positive? -- just above in the slip
            - 2)) (after `if`) decrease number of auctions
        - `_remove(id)` -- remove from `active`, clear `sales[id]` ^LSC--remove
          - -- remove `id` from `active` (active auction ids) and clear in `sales` (id => struct) 
          - `_move = active[active.length - 1];` -- last active auction id
            - active -- stores active auction ids [[#^LSC-kick--active-push]]
            - active.length - 1 -- last element
          - `if (id != _move) {` -- `take`(passed by liquidator) is not for the last auction
            - -- id passed by `take`r is not last
          - `_index = sales[id].pos` -- this auction index in `active`
            - sales -- auction id => struct [[#^LSC--sales]]
            - sales.pos -- Index in `active` array
          - rest: swap id with last element, then delete id and `sales[id]`
        - `} else if (tab == 0) {` -- have collateral, but no debt 
          - tot; -- `lot` (collateral) at auction start, ~immutable.  [[#^LSC--sales]] 
          - `vat.slip(ilk, address(this), -int256(lot))` -- reduce gem (free collateral) by `lot` (amount collateral left to liquidate after current `take`)
            - why `lot`? not `tot - lot`? -- because LC doesn't want this collateral anymore, debt is covered. Time to return the reset to `urn` in [[#^LSE-onRemove]]
              - probably because we have no debt anymore, collateral should be sent to `urn`? -- yes, on remove `left - burnFee(~15%)` will be sent to `urn` in `onRemove`. [[#^LSE-onRemove]]
                - `left` - burnFee (15% of sold)
            - where will collateral go after? to `urn`? -- yep
          - `engine.onRemove(usr, tot - lot, lot)` -- main: burn fee; refund MKR  [[#^LSE-onRemove]]
            - args
              - usr -- Liquidated CDP (urn)
                - from  [[#^LSC--sales]] by `take`r provided `id`
              - `tot - lot` -- sold in an auction
              - `lot` -- collateral left (should return to the urn)
            - slip and frob -- ~mint MKR back to the `urn`
              - `vat.slip` -- ~mint MKR to `vat.gem[ilk][urn]`
              - `vat.frob` -- (here) `vat.gem[ilk][urn]` =(MKR)=> `vat.urns[ilk][usr];` Deposit free collateral to the urn
          - [[#^LSC--remove]]
- redo -- reset time, price; give reward to keeper ^LSC-redo
    - [[#^LSC--sales]]
    - [[#^LSC-take--usr-addr0]]
    - reset start time, reset start price to new market price * buffer
      - [[#^LSC--sales--top]]
      - [[#^LSC-getFeedPrice]]
    - [[#^LSC-kick--hasReward]] -- if LSC gives rewards (set by admin) && (DAI debt && MKR collateral) both >= dust => reward keeper (redo ~caller)
      - `if (tab >= _chost && lot * feedPrice >= _chost) {` -- debt and collateral left >= dust
        - chost -- dust * (1 + penalty), in DAI [[#^LSC--chost]]
        - tab -- auction total in DAI 
          - [[#^LSC--sales]] 
- yank -- cancel auction in dog and here, move MKR to end.sol => vow.sol ^LSC-yank
    - called by [`end.snip`](https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/end.sol#L366)
    - [[#^LSC-take--usr-addr0]] -- is auction active/exist
    - `dog.digs(ilk, sales[id].tab)` -- reduce DAI in auctions [[#^dog-digs]]
    - `vat.flux(ilk, address(this), msg.sender, lot);` -- move MKR from LSC to caller (end.sol).
      - vat.flux -- move gem (internal collateral balance) to another account [[#^vat-flux]]
      - end will probably transfer it to vow using vat.grab [gh](https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/end.sol#L371)
    - `engine.onRemove(sales[id].usr, 0, 0);` -- no burn, no mint, no refund. Just reduce counter `urnAuctions[urn]--;`
      - [[#^LSE-onRemove]]
    - [[#^LSC--remove]] -- remove from `active`, clear `sales[id]`
- getStatus
    - [[#^LSC--sales]]
    - [[#^LSC-status]]
    - [[#^LSC-take--usr-addr0]]
- upchost
    - [[#^LSC--chost]]
### LockstakeEngine 
^LSEngine
- > aka [Sagittarius Engine](https://endgame.makerdao.com/tokenomics/sagittarius-engine)
- `open` -- Deploy urn; set `msg.sender` as the urn's owner ^LSE-open
  - `index == usrAmts[msg.sender]++` -- Ensures the urn is created with the last index ^LSE--usrAmts
	- `usrAmts[msg.sender]++`
	  - `usrAmts` is? -- Urn counter by user
	  - `usrAmts` updated where? -- Only in `open`
	  - `++` first return value, then increase? -- Yep
  - `_initCode()` -- Code for proxy EIP-1167
	- https://eips.ethereum.org/EIPS/eip-1167
	  - https://blog.openzeppelin.com/deep-dive-into-the-minimal-proxy-contract
	  - https://www.rareskills.io/post/eip-1167-minimal-proxy-standard-with-initialization-clone-pattern
	- `selfdestruct` changed in some EIPs; now it can't be called -- Yep, it still sends all ETH but is destroyed if executed in the same transaction as the contract was created
	  - [ ] https://www.evm.codes/#ff?fork=cancun
	  - [ ] https://medium.com/buildbear/what-is-the-ethereum-cancun-deneb-dencun-update-dde8bd9943ae
	  - [ ] https://eips.ethereum.org/EIPS/eip-6780
- `selectFarm` -- Update `urnFarms[urn] = farm` and move funds to the new farm or LSE ^LSE-selectFarm
  - > Ensure the urn is not in auction, the farm is approved by Maker, and it’s not the same farm. Move `lsMKR` to the farm or LSE, and update storage.
  - `urnAuth` -- Owner or approved ^LSE-urnAuth
	- How is `urnCan` set? -- hope/nope by `urnAuth`ed
	- How are `urnOwners` set? -- On [[#^LSE-open]]
  - Where does `urnAuctions[urn]` change? -- OnKick++, onRemove-- [[#^LSE--urnAuctions]]
  - What is `farm`? -- authed; deposit `lsMKR` to receive DAI or subDaoGovs
	- Deposit `lsMKR` -> Choose farm (initially only DAI). Then, receive subDao Gov tokens.
	  - [endgame docs](https://endgame.makerdao.com/tokenomics/sagittarius-engine#token-farming)
  - How is `farms[farm]` set and changed? -- Approved add/del -- ^LSE--FarmStatus
	- Enum FarmStatus {
	  - UNSUPPORTED, -- Default
	  - ACTIVE, -- Added via `addFarm` (authorized)
	  - DELETED -- Removed via `delFarm` (authorized)
	}
  - `urnFarms[urn]` -- Maps urn to farm ^LSE--urnFarms
	- How is `urnFarms[urn]` changed? -- In `selectFarm`, onKick
	  - Only in `_selectFarm`
		- `selectFarm`
		- `onKick`
	- On [[#^LSE-selectFarm]], check that `farms[farm] == ACTIVE`.
	- OnKick, it is reset to 0.
	- `farms[farm]` is set by authorized actions [[#^LSE--FarmStatus]]
  - `(uint256 ink,) = vat.urns(ilk, urn);` -- MKR balance for urn [[#^vat-urns]]
	- MKR or `lsMKR`? -- It should be MKR
	  - `ilk` -- Probably bytes32 for MKR
	- Why `urn`? -- It should == to MKR, likely just more convenient ^LSE-selectFarm--why-urn-balance
	  - Explanation: It’s probably because `vat.urns[ilk][urn]` is always on LSUrn for the user, while MKR can be on LSE or Chief. It belongs to LSE and is mixed with other depositors.
	  - `urn` vs MKR `balanceOf` -- MKR is on LSE or Chief; urn is on LSUrn
		- MKR: usr => LSE => VD => Chief (on [[#^LSE-lock]]) ^LSE--mkr-flow
		- `vat.urns`: LSUrn balance increases on [[#^LSE-lock]]
		- Where is `vat.urns[ilk][urn]` balance changed?
		  - Open? -- No
		  - Lock? -- Yes [[#^LSE-lock]]
			- MKR => LSE; `vat.urns[ilk][urn]` increases
		  - Free? -- Yes
	  - How does `vat.urns[ilk][urn]` change with the deposit of MKR?
		- `gem` is changed using [join.join](https://github.com/makerdao/dss/blob/master/src/join.sol#L108-L114), which transfers `gem` on `join` and increases `vat.gem`.
		- `vat.frob` can lock `gem` to an urn [[#^LSC-kick--vat-frob]] and mint DAI.
		  - You can change the amount of DAI wanted using the `dart` argument.
		- It’s possible to move from one urn to another using `vat.fork`.
  - `_selectFarm` -- Move funds to a new farm (or LSE if no `farm` is passed); update the urn's farm ^LSE-i-selectFarm
	- Use case for `_selectFarm` [[#^LSE-onKick--i-selectFarm]]
	- `wad` -- Here, `ink`, collateral amount
	- `LockstakeUrn(urn).withdraw(wad)` -- Withdraw staked `wad` of MKR to LockstakeUrn ^LSU-withdraw
	  - `StakingRewardsLike(farm).withdraw` = [endgame-toolkit/src/synthetix/StakingRewards.sol::withdraw](https://github.com/makerdao/endgame-toolkit/blob/sherlock-contest/src/synthetix/StakingRewards.sol#L115-L121) -- Transfer amount to `msg.sender`
	- `LockstakeUrn(urn).stake(farm, wad, ref)` -- Move MKR to `farm`, increase the farm's internal balances ^LSU-stake
	  - `updateReward` -- Update accumulator and time for all; add `rewards` for `account` ^SR-updateReward
		- `rewardPerToken` -- Old value plus accrued interest since the last time `updateReward` was called
		  - `rewardPerTokenStored` -- `rewardPerToken` on the last `updateReward` call
		- `lastTimeRewardApplicable` -- Now or when the farm finishes
		- `earned` -- Old `rewards` plus newly accrued
		  - `userRewardPerTokenPaid` -- Already paid. Accumulator `rewardPerTokenStored`
			- Updated in `updateReward` each time reward is moved to `rewards`

- `selectVoteDelegate` -- Move MKR to LSE. Optionally to VD => VD.chief
  - > Check: not in auction, VD created by factory, oldVD != newVD, urn is over-collateralized. Move MKR to LSE. Optionally to VD => VD.chief.
  - [[#^LSE-urnAuth]], [[#^LSE--urnAuctions]]
  - How `voteDelegateFactory.created` is set? -- on `voteDelegateFactory.create`
  - `urnVoteDelegates[urn]` => urn => voteDelegate
	- Changed on `_selectVoteDelegate`
	  - `selectVoteDelegate`
	  - `onKick`
  - `(uint256 ink, uint256 art) = vat.urns(ilk, urn);` -- collateral MKR, debt DAI for urn ^vat-urns
	- `ink` -- collateral balance, MKR
	- `art` -- debt, DAI
	- `urns` -- `urns[ilk bytes32][user address] => Urn{ink(collateral amt, MKR), art(debt DAI)}`
	  - From [docs](https://docs.makerdao.com/smart-contract-modules/core-module/vat-detailed-documentation#glossary-vat-vault-engine)
		- `urns`: a mapping of Urn types.
		- Urn: a specific Vault.
		  - `ink`: collateral balance.
		  - `art`: normalized outstanding stablecoin debt.
	  - `urns[ilk bytes32][user address] => Urn{ink(collateral amt, MKR), art(debt DAI)}` [code](https://github.com/makerdao/dss/blob/master/src/vat.sol#L57)
  - `(, uint256 rate, uint256 spot,,) = vat.ilks(ilk);` -- for the line below
	- `vat.ilks` -- ilk bytes32 => struct
	  - struct Ilk {
		- uint256 Art;   // Total Normalized Debt     [wad]
		- uint256 rate;  // Accumulated Rates         [ray]
		- uint256 spot;  // Price with Safety Margin  [ray]
		- uint256 line;  // Debt Ceiling              [rad]
		- uint256 dust;  // Urn Debt Floor            [rad]
	  - }
	- `rate` -- nDAI to DAI conversion rate ^vat-ilks-rate
	  - Stablecoin debt multiplier (accumulated stability fees). [docs](https://docs.makerdao.com/other-documentation/system-glossary#vat-vault-engine)
	  - nDAI to DAI conversion rate
	  - Multiplier to get DAI from art (nDAI)
	- `spot` -- asset price in DAI, scaled up by LTV ^vat-ilks-spot
	  - What is the safety margin? -- LTV
		- Glossary: collateral price with safety margin, i.e., the maximum stablecoin allowed per unit of collateral.
		- On vat.file, vat just saves what spot gives
		- `spot.poke` -- get asset price in DAI, scale up by LTV, `vat.file` it
		  - `rdiv(rdiv(mul(uint(val), 10 ** 9), par), ilks[ilk].mat)` -- asset price in DAI scaled up by LTV
			- > Convert asset price in UoV to DAI; increase by liquidation ratio
			- GPT simplified: `val / par / ilks[ilk].mat;`
			- `val`, has -- fetched from oracle
			  - `pip.peek` -- getPrice ^pip-peek
				- How is `has` set?
				  - What if the price is stale? -- will revert [osm.poke](https://github.com/makerdao/osm/blob/master/src/osm.sol#L132)
				  - In OSM, it can be reset by an authorized user calling `void`
					- [docs](https://docs.makerdao.com/smart-contract-modules/oracle-module/oracle-security-module-osm-detailed-documentation)
					- [osm.void](https://github.com/makerdao/osm/blob/master/src/osm.sol#L122-L125)
			- `par` -- Unit of Value / DAI, e.g., 0.8EUR/DAI
			  - [docs](https://docs.makerdao.com/other-documentation/system-glossary#spot-oracles-and-contracts-liaison) "the relationship between DAI and 1 unit of value in the price"
			  - [[#^LSC--sales--top--par]]
			  - [[#^LSC-getFeedPrice]] `val/par`
			- `mat` -- ilk's liquidation ratio (`mat`) -- lower => can liquidate
			  - [[#^spot-ilk-mat]]
	- `ink * spot >= art * rate` -- isOverCollateralized
	  - Exp: collateral value + risk LTV >= debt
	  - `ink` -- collateral amt, MKR
	  - `spot` -- collateral price in DAI, scaled up by LTV [[#^vat-ilks-spot]]
	  - `art` -- debt amt, nDAI
	  - `rate` -- nDAI to DAI conversion rate [[#^vat-ilks-rate]]
	  - `ink * spot` -- collateral value in DAI, scaled by LTV
	  - `art * rate` -- debt in DAI
  - `_selectVoteDelegate` -- move MKR to LSE, optionally delegate to VD => VD.chief. Update `urnVD[urn] = VD`
	- `wad` = `ink` = collateral amt on `urn`, in MKR
	- Usage in `onKick` [[#^LSE-onKick--i-selectVoteDelegate]]
	- `VoteDelegateLike(prevVoteDelegate).free(wad)` -- return MKR to LSE [[#^VD-free]]
	- `VoteDelegateLike(voteDelegate).lock(wad)` -- MKR: usr => LSE => VD => VD.chief
	  - `hatch` -- lock `lock` function for X blocks
		- GPT: The hatch mechanism provides a buffer period during which no new tokens can be locked, possibly to protect against sudden governance attacks or changes during critical voting periods.
		- `hatchTrigger` -- when `reserveHatch()` was called
		- `HATCH_SIZE` -- 5, number of blocks to wait after `reserveHatch()` is called
		- `HATCH_COOLDOWN` -- 12, number of blocks to wait until anyone can call `reserveHatch()` again
	- Delegate uses MKR, farm uses `lsMKR` [[#^LSE-lockMkrTwice]]
	- [[#^LSE-selectFarm--why-urn-balance]]
- `draw` -- increase `urn`'s `dart`(nDAI) debt, mint ERC20 NST to `urn` ^LSE-draw
  - Exp: update and get latest `rate`, get latest `dart`(nDAI) for user-provided `wad`, create `dart` debt for the urn, print `dai` for the LSE, convert internal `dai` to ERC20 NST and send to user
	- From vat [docs](https://docs.makerdao.com/smart-contract-modules/core-module/vat-detailed-documentation) (similar function) -- `draw`: increase Vault debt, creating Dai.
  - `jug.drip` -- add virtual profit (stability fees) from loans to `vow`, return the latest `rate` (accum to convert nDAI (art) to DAI) ^jug-drip
	- Exp: updates `rate` (accumulator to convert nDAI to DAI debt)
	- [docs](https://docs.makerdao.com/other-documentation/system-glossary): collect stability fees for a given collateral type
	- [jug docs](https://docs.makerdao.com/smart-contract-modules/rates-module/jug-detailed-documentation)
	  - [drip](https://docs.makerdao.com/smart-contract-modules/rates-module/jug-detailed-documentation#drip)
		- `accumulatedFromLastCall` = `(baseRate + collateralRate)^timePassed`
		- `newRate` = `prevRate * accumulatedFromLastCall`
	- [jug.drip code](https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/jug.sol#L122-L128) -- add virtual profit from loans to `vow`
	  - `rho` -- the timestamp of the last fee update
		- Won't `(now >= ilks[ilk].rho)` revert? -- no, `>=` and is set to `now`
	  - `vat.fold` -- add system profit from fees on borrowing to `vow`
		- Update `ilk.rate` -- accumulator of fees
		- Increase `dai` for user -- vow's DAI balance
		- Increase `debt` -- system-wide debt of all users, sum of `dai`
  - Why do we need to call `jug.drip`? -- Simple, to get the latest `rate`
	- Looks like otherwise user loses money somehow
	  - [scReadme](https://github.com/makerdao/sherlock-contest/blob/master/README.md) says: `wipeAll` and `wipe do not drip because it is actually not convenient for the user to do a drip call on wiping. Then, if we force the drip, we are incentivizing users to repay directly to the vat (which is possible) instead of using the engine for that. We are mimicking the old proxy actions behavior, where we drip for drawing, as otherwise the user can lose money, but not forcing the drip on wiping so users actually use this function.
	- Docs for [drip](https://docs.makerdao.com/smart-contract-modules/rates-module/jug-detailed-documentation#drip)
	  - `drip(bytes32 ilk)` performs stability fee collection for a specific collateral type when it is called (note that it is a public function and may be called by anyone). `drip` does essentially three things:
		1. Calculates the change in the rate parameter for the collateral type specified by `ilk` based on the time elapsed since the last update and the current instantaneous rate (`base + duty`);
		2. Calls `Vat.fold` to update the collateral's `rate`, total tracked debt, and Vow surplus;
		3. Updates `ilks[ilk].rho` to be equal to the current timestamp.
  - `dart` -- usually diff in `art`, nDAI
  - Why `_divup`? -- `dart` is debt, in favor of protocol to increase it
	- `wad` -- amt of dai
	- `dart` is debt, so we want to round in favor of the protocol, increasing the user's debt
  - `vat.frob(ilk, urn, address(0), address(this), 0, int256(dart));` -- increase urn's `dart`(debt), increase `dai` (internal ERC20 DAI balance) for LSE ^LSE-draw--vat-frob
	- [[#^vat-frob]]
	- //args: i,u,v,w,dink,dart
	- Modifies `urn`,
	  - Using no `gem` (user `v` is 0, `dink` is 0)
	  - Creating `dai` for user `address(this)`
  - `nstJoin.exit(to, wad);` -- lock user's DAI (not debt) internal `vat.dai` balance on `NstJoin`, mint NST to the user -- ^NstJoin-exit
	- `nst/README.md`
	  - Says ~the same as `DaiJoin`
		- `DaiJoin` - allows users to withdraw their Dai from the system into a standard ERC20 token. [docs](https://docs.makerdao.com/smart-contract-modules/collateral-module/join-detailed-documentation)
	- `vat.move(msg.sender, address(this), RAY * wad);` -- transfer DAI from `msg.sender` to `address(this)`
	  - Transfer DAI from, to, amt [[#^vat-move]]
	- What is `vat.dai`? -- Basically DAI balance, debt is in `urn`
- `wipe` -- burn `msg.sender`'s NST, decrease `urn`'s debt ^LSE-wipe
  - Explain:
	- Get NST from the user
	- Burn it on `NstJoin`
	- Decrease urn's debt
  - ~ `vat.wipe` -- decrease Vault debt, destroying Dai.
- `wipeAll` -- burn `msg.sender`'s NST, decrease `urn`'s debt ^LSE-wipeAll
	- Explain:
		- Get all debt in DAI
		- Get NST (1:1) from `msg.sender`
		- Convert to `vat.dai` (burn NST, add `vat.dai`)
		- Decrease `urn`'s debt
	- `(, uint256 art) = vat.urns(ilk, urn);` -- `urn`'s nDAI debt
	- `wad = _divup(art * rate, RAY);` -- convert to DAI
		- Debt, that's why up
- `lock` -- deposit MKR to LSE; mint `lsMKR` to `LSUrn`; optionally delegate (move) MKR, stake `lsMKR` ^LSE-lock
	- MKR: `msg.sender` => LSEngine ?=> VoteDelegate => Chief [code](https://github.com/dapphub/ds-chief/blob/master/src/chief.sol#L49-L57), [docs](https://docs.makerdao.com/smart-contract-modules/governance-module/chief-detailed-documentation#lock-uint-wad)
	- Mint `lsMKR` 1:1 => `LSUrn` ?=> StakingRewards
	- `_lock` -- transfer-delegate MKR, increase `LockstakeUrn`'s collateral (MKR) balance on Vat, mint `lsMKR` 1:1 to `LockstakeUrn`, stake `lsMKR`
		- > MKR: LSE => VoteDelegate => Chief [code](https://github.com/dapphub/ds-chief/blob/master/src/chief.sol#L49-L57), [docs](https://docs.makerdao.com/smart-contract-modules/governance-module/chief-detailed-documentation#lock-uint-wad) + [[#^LSE--mkr-flow]]
		- > `lsMKR`: (mint) => `LockstakeUrn` => StakingRewards ^LSE--lsMkr-flow
			- [[#^Q--lsmkr-move]]
		- How is `urnOwners[urn]` set? -- on `open` to `msg.sender`, won't change
		- `urnVoteDelegates[urn]` -- on `selectVoteDelegate`, checked by `voteDelegateFactory.created`
		- `vat.slip` -- increase gem [[#^vat-slip]]
		- `vat.frob(ilk, urn, urn, address(0), int256(wad), 0)` -- move collateral (MKR) from `address urn`'s `vat.gem` (free collateral) to `address urn`'s `vat.urns` (vault) ^LSC-kick--vat-frob
			- Change only `dink` (collateral) of `urn`. Increase
			- Why `urn` if it should be user? -- By default `urnHandler`, but can be `msg.sender`/approved too. Here `LockstakeUrn` is the owner
				- It can be either user or `urnHandler` (deployed for each CDP, see `open` in [DssCdpManager](https://github.dev/makerdao/dss-cdp-manager/blob/master/src/DssCdpManager.sol))
				- By default, without CDP, one user => one urn per ilk.
					- CDP deploys `urnHandler` => can have more than one
				- It looks like here `LockstakeUrn` is the owner of `vat.urn`
			- `vat.frob(bytes32 i, address u, address v, address w, int dink, int dart)` -- modifies `urn` of user `u`, using `gem` from user `v` and creating `dai` for user `w` ^vat-frob
				- > "Vaults are managed via `frob(i, u, v, w, dink, dart)`, which modifies the Vault of user `u`, using `gem` from user `v` and creating `dai` for user `w`." [docs](https://docs.makerdao.com/smart-contract-modules/core-module/vat-detailed-documentation#vault-management)
				- `i` -- ilk, collateral type
				- `u` -- owner of modified `urn`
				- `v` -- owner of modified `gem` (collateral)
				- `w` -- owner of modified `dai` (DAI internal balance)
				- `dink` -- diff collateral, +-
				- `dart` -- diff nDAI +-
		- `slip` + `frob` -- increase `vat.urns` `urn` collateral
		- `lsmkr.mint` -- mint LST/LP tokens 1:1
			- `lsmkr` = `lockstake/src/LockstakeMkr.sol`
				- What is it? -- probably LP/LST tokens, 1:1
		- `urnFarms[urn]` -- on [[#^LSE-selectFarm]], checked that `farms[farm] == Active`
			- `farms[farm]` is set by authed [[#^LSE--FarmStatus]]
		- [[#^LSU-stake]]
- `lockNgt` -- NGT converted to MKR, then [[#^LSE-lock]]
	- `mkrNgt.ngtToMkr(address(this), ngtWad);` -- burn NGT, mint MKR
- `free` -- burn `lsMKR`, burn 15% fee MKR, return the rest ^LSE-free
	- `_free(urn, wad, fee)` -- burn `urn`'s staked `lsMKR`, burn `urn`'s MKR on `vat`, withdraw MKR from VD and burn 15% fee
		- Fee -- oh, it's 15% on unstake
		- `urnFarms` -- [[#^LSE--urnFarms]]
		- [[#^LSU-withdraw]]
		- When did `urn` give allowance for `lsMKR` to LSE? -- `LSU.init`
		- `vat.frob(ilk, urn, urn, address(0), -int256(wad), 0);` -- free collateral from an `urn.ink` to `gem`
			- Related [[#^LSC-kick--vat-frob]]
			- Move collateral (MKR) to `address urn`'s `vat.gem` (free collateral) from an `address urn`'s `vat.urns` (vault)
		- `vat.slip(ilk, urn, -int256(wad));` -- decrease `gem` -- [[#^vat-slip]]
		- `frob` + `slip` -- burn collateral on `vat` ^LSE-free--frob-plus-slip
		- `VoteDelegateLike(prevVoteDelegate).free(wad);` -- return `wad` MKR to `LockstakeEngine` -- ^VD-free
			- `chief.free` -- return `wad` MKR to VoteDelegate
				- [code](https://github.com/dapphub/ds-chief/blob/master/src/chief.sol#L59-L67) ⬇︎ deposit, ⬇︎votes, burn IOU, return GOV (MKR)
					- Weight? -- number of tokens = deposits = votes
						- Weights = deposits = GOV (MKR) tokens locked on the contract
						- [subWeight gh](https://github.com/dapphub/ds-chief/blob/master/src/chief.sol#L121-L128) -- reduce `approvals` for each `yay` (candidate)
						- Chief [docs](https://docs.makerdao.com/smart-contract-modules/governance-module/chief-detailed-documentation)
						- `yays` -- candidates/addresses of possible chiefs
						- `slates` -- sets of candidates, so you can vote for several
						- `approvals` -- how much each candidate gets
						- One user can choose multiple `yays` (using slate). Each `yay` will get `weight` amount.
							- E.g., user has weight 10. Votes for 1 `yay`. 1 `yay` gets 10 votes. Votes for 10 `yays`, __each__ gets 10 votes
							- So a user can vote for only one slate, but a slate has several `yays`. In that case, each `yay` will get the same number of votes = deposited tokens. It won't be split.
				- [Chief docs](https://docs.makerdao.com/smart-contract-modules/governance-module/chief-detailed-documentation#free-uint-wad) "Charges the user `wad` `IOU` tokens, issues an equal amount of `GOV` tokens to the user, and subtracts `wad` weight from the candidates on the user's selected slate. Fires a `LogFree` event."
		- Burn fee 15%
- `freeNgt` -- same as `free`, but convert (`mkrNgt.mkrToNgt`) to NGT
- `freeNoFee` -- same, but 0 fee burned, authed
- `getReward` -- transfer accrued rewards from SR to `to`, in `rewardsToken`
	- [[#^LSE--FarmStatus]]
	- `LockstakeUrn(urn).getReward(farm, to);` -- getReward from SR in `rewardsToken`, then transfer _all_ LSU balance to `to` (caller provided)
		- `StakingRewardsLike(farm).getReward();` -- transfer accrued rewards to `msg.sender`
			- [[#^SR-updateReward]]
			- `rewards[msg.sender];` -- latest accrued rewards, updated in `updateRewards` modifier
- [[#^LSE-onKick]]
- [[#^LSE-onTake]]
- [[#^LSE-onRemove]]
- Public vars
	- [[#^LSE--usrAmts]]
## sdai/SNst
- UUPSUpgradeable
	- docs
		- https://docs.openzeppelin.com/contracts/4.x/api/proxy#transparent-vs-uups
		- https://eips.ethereum.org/EIPS/eip-1822
	- code
		- top comment 
			- UUPS proxy -- regular proxy with upgrade functionality on the implementation instead of in the proxy itself
			- ERC1967Proxy -- basically just a standard slot for the implementation address
				- rollback -- check that the new implementation allows further upgrades (e.g., `upgradeTo(address)` is not removed)
		- comment UPGRADE_INTERFACE_VERSION
			- This variable was introduced in 5.0. In 4.9.x (and probably prior), the contract had 2 functions: `upgradeTo` and `upgradeToAndCall`. The latter one will `forceCall` even when `data` is empty 
				- If this getter is missing, both `upgradeTo(address)` and `upgradeToAndCall(address,bytes)` are present -- if missing => previous version that had both functions. The current version only has `upgradeToAndCall`
					- why?
						- This contract only has `upgradeToAndCall`
						- [4.9.6](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/v4.9.6/contracts/proxy/utils/UUPSUpgradeable.sol) does not have `UPGRADE_INTERFACE_VERSION`, but has both `upgradeTo` and `upgradeToAndCall`
				- `upgradeTo` must be used if no function should be called
				- while `upgradeToAndCall` will invoke the `receive` function if the second argument is an empty byte string
					- `upgradeToAndCall` passes `forceCall=true` from 4.9.0-4.9.6, 
						- [upgradeToAndCall](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/f6febd79e2a3a17e26969dd0d450c6ebd64bf459/contracts/proxy/utils/UUPSUpgradeable.sol#L91) => `_upgradeToAndCallUUPS` => [`_upgradeToAndCall`](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/f6febd79e2a3a17e26969dd0d450c6ebd64bf459/contracts/proxy/ERC1967/ERC1967UpgradeUpgradeable.sol#L89) => [`if (data.length > 0 || forceCall) {`](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/f6febd79e2a3a17e26969dd0d450c6ebd64bf459/contracts/proxy/ERC1967/ERC1967UpgradeUpgradeable.sol#L67)
			- In > 5.0, only `upgradeToAndCall`. No `forceCall`. No `data` - no call
				- If the getter returns `"5.0.0"`, only `upgradeToAndCall(address,bytes)` is present, 
				- and the second argument must be the empty byte string if no function should be called, 
				- making it impossible to invoke the `receive` function during an upgrade
		- onlyProxy -- not calling Implementation directly; `getImplementation` slot (on Proxy) returns `__self` => Proxy calls the expected Implementation
			- ! `address(this) == __self` (set in constructor, immutable, inside the code) -- not self call, direct implementation call
			- `ERC1967Utils.getImplementation() (= StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value)` != `__self` -- implementation slot on the proxy contract must be set to `__self` (embedded in Implementation code);
				- If the implementation you call, that knows its address, written inside the code, understands that it was called from a Proxy, it makes sense to revert if it thinks that calling the same address.
			- "Execution of a function through ERC1167 minimal proxies (clones) would not normally pass this test, but is not guaranteed to fail." Why not guaranteed? -- because `getImplementation` slot is not _usually_ set on 1167. A second check will return true, 0 != `__self`. But it can be set; nothing prohibits it.
				- `__self` is address1, e.g., 0x1
				- `StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value` is usually 0
				- => `address(this) == __self` false, 
					- `address(this)` = 0x2
					- `__self` == 0x1
					- 0x2 == 0x1 => false
				- => `ERC1967Utils.getImplementation() != __self` 
					- getImplementation == 0
					- `__self` == 0x1
					- 0 != 0x1 => true
		- Why do we need to validate `proxiableUUID` = slot address on upgrade?
			- If slots are different, then `onlyProxy` won't work 
		- "IMPORTANT: A proxy pointing at a proxiable contract should not be considered proxiable itself, because this risks bricking a proxy that upgrades to it, by delegating to itself until out of gas. Thus it is critical that this function revert if invoked through a proxy. This is guaranteed by the `notDelegated` modifier."
			- Proxiable = Logic contract = implementation
			- "risks bricking a proxy that upgrades to it"
				- Wrong: Proxy1 => Proxy2 => Logic
					- Original: Proxy => Logic
					- Proxy1 sets the implementation to Proxy2. 
			- "by delegating to itself until out of gas"
				- Oh, so Proxy1.slot is set to Proxy2.address
				- User => Proxy1 {storage} => Proxy2 {Logic}
				- User => P1.f1 => P1.fallback => P1.impl.f1 
					  => P2.f1 => P2.fallback => P2.impl.f1 (=P1.impl =P2) 
					  => P2.f1 =>... 
				- Proxy2.fallback is looking for the implementation slot, reads Proxy1.slot == Proxy2.address, calls Proxy2, gets to Proxy2.fallback again
			- "Thus it is critical that this function revert if invoked through a proxy. This is guaranteed by the `notDelegated` modifier."
					- User => P1.f1 => P1.fallback => P1.impl.f1 
					- (notDelegated)
						- `address(this) != __self` => true => revert
							- address(this) == P1
							- `__self` == P1.impl == P2
							- P1 != P2 => true => revert
		- `_upgradeToAndCallUUPS` calls `proxiableUUID`
			- User => P1.utac(P2) => P2.proxiableUUID => P2.`_checkNotDelegated`
				- `address(this)` == P2
				- `__self` = C3
				- P2 != C3 => true => revert
			- User => P1.utac(C3) => C3.proxiableUUID => C3.`_checkNotDelegated`
				- `address(this)` == C3
				- `__self` = C3
				- C3 != C3 => false => ok
- --
- constructor
	- why `_disableInitializers` -- so Logic=Impl is not initialized
		- docs: "Calling this in the constructor of a contract will prevent that contract from being initialized or reinitialized to any version. It is recommended to use this to lock implementation contracts that are designed to be called through proxies."
		- why is it bad to init a logic, it is used only as a source of code? -- can delegatecall to `SELFDESTRUCT`, but should not be a problem now, unless in the same transaction. low
			- https://forum.openzeppelin.com/t/uupsupgradeable-vulnerability-post-mortem/15680#vulnerability-2
			- Yep, not a problem, see https://github.com/OpenZeppelin/openzeppelin-contracts/issues/4974#issuecomment-2022806964
- initialize
	- initializer -- called once
	- `__UUPSUpgradeable_init` -- empty
	- chi -- interest (profit for lender, loss for borrower)
		- gpt: accumulates the interest over time.
		- docs: the rate accumulator. This is the always increasing value which decides how much `dai` is given when `drip()` is called.
			- related: [[#^jug-drip]]
	- rho -- timestamp for chi
		- gpt: the last time the interest was accumulated.
		- docs: the last time that drip is called. 
			- related: [[#^jug-drip]]
	- nsr -- rate
		- gpt: determines the rate at which interest accumulates.
		- NST Savings Rate
	- who calls it in deploy scripts? -- deployer, inside `new`
		- Deployer => ERC1967Proxy --

Proxy=Storage contract
		- Deployer becomes a ward
			- Deployer => ERC1967Proxy (msg.sender = deployer) -> impl (msg.sender = deployer)
- drip -- mint accrued interest as NST on SNst. From increasing `vow.sin` (system debt). Returns new accumulator ^SNst-drip
	- `nChi` -- new accumulator (adds fees since the last update)
		- `= _rpow(nsr, block.timestamp - rho_) * chi_ / RAY;`
		- `=(nsr^(now−rho)) * chi`
		- `= chi * nsr^timeSinceLastUpdate`
			- Where
				- **nChi** is the new rate accumulator.
				- **nsr** is the NST Savings Rate.
				- **now** is the current timestamp.
				- **rho** is the timestamp of the last interest accrual.
				- **chi** is the previous rate accumulator.
				- **RAY** is a constant representing 1e27
			- now - rho -- timeSinceLastUpdate
			- nsr -- savingsRate
			- `savingsRate^timeSinceLastUpdate` -- accumulatedMultiplier
			- `accumulatedMultiplier * chi` -- accumulatedSinceTheStart
	- `diff` -- profit since the last update
		- `= totalSupply_ * nChi / RAY - totalSupply_ * chi_ / RAY;`
			- which UoV? -- NST
			- currentProfit - profitOnLastUpdate
	- `vat.suck(address(vow), address(this), diff * RAY);` -- Increase bad debt on `vow` by `diff` DAI. Increase internal `vat` DAI balance of SNst 
		- [[#^vat-suck]]
	- `nstJoin.exit(address(this), diff);` -- lock `suck`ed `vat.dai` balance on NstJoin, mint NST on SNst
		- [[#^NstJoin-exit]]
	- Why do we increase `vow.sin`?
		- System minted free DAI
		- It will be canceled later from profits
			- More details later in [[#^SNst-Q--vow-sin-cancel]]
- deposit -- lock NST, mint SNst
	- shares = assets * RAY / drip(); -- shares to mint per NST provided
		- assets -- NST to spend
		- drip -- accumulator of profit 
		- the bigger the accumulator (the more time has passed) -> the fewer shares you get -> share price goes up
	- `_mint(assets, shares, receiver)` -- get NST from msg.sender, mint SNst to receiver
- mint -- same, but asks for the amount of SNst to get
- withdraw -- burn SNst, unlock (transfer) NST
	- `shares = _divup(assets * RAY, drip());` -- same as drip, but burn more shares
	- `_burn` -- burn shares (SNst), transfer NST
- redeem -- same, but provides shares to burn amount, not NST to receive
- --
- Qs
	- How `vow.sin` (generated in `drip`) is canceled -- mostly from DAI minters' fees, also liquidations ^SNst-Q--vow-sin-cancel
		- Users who put collateral (ETH) and minted DAI pay to SNst holders it seems. Basically from `urn`s? -- yes
			- [docs](https://docs.makerdao.com/smart-contract-modules/core-module/vat-detailed-documentation#vault-management) -- can be canceled with `dai` on `vow`
				- Sin represents "seized" or "bad" debt and can be canceled out with an equal quantity of DAI using `heal(uint rad)` where `msg.sender` is used as the address for the `dai` and `sin` balances.
					- **Note:** Only the Vow will ever have `sin`, so only the Vow can successfully call `heal`. This is because whenever `grab` and `suck` are called, the Vow's address is passed as the recipient of `sin`. Note that this is contingent on the current design and implementation of the system.
					- **Note:** `heal` can only be called with a positive number (uint) and will `sub(dai[u])` along with `sub`ing the `sin`.
			- How does `dai` get on `vow`? -- jug.drip
				- **System Surplus:** Occurs from stability fee accumulation, resulting in additional internal DAI in the `Vow`. [docs](https://docs.makerdao.com/smart-contract-modules/system-stabilizer-module/vow-detailed-documentation#id-3.-key-mechanisms-and-concepts)
				- https://docs.makerdao.com/smart-contract-modules/rates-module#stability-fee-accumulation 
					- [[#^jug-drip]] -- creates surplus on vow; from fees on borrowers (DAI minters). 
						- Borrowers need to return more DAI over time, and this additional DAI goes to `vat.dai`
					- pot.drip -- creates debt on vow, gives to Pot; same as SNst
						- DAI depositors (lock) get profit. It will be covered from DAI borrowers
- public vars
	- PERMIT_TYPEHASH
		- https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md
		- permit
			- [EIP2612](https://eips.ethereum.org/EIPS/eip-2612)
				- [OZ Erc20Permit](https://github.dev/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/extensions/ERC20Permit.sol)
				- [EIP712](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/cryptography/EIP712.sol)
				- [MessageHashUtils](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/cryptography/MessageHashUtils.sol)
## dss-flapper
- FlapperUniV2
	- > user -> vow.flap -> flapper(Splitter).kick -> FlapperUniV2.exec
	- exec -- simplified: exchange 50% of DAI for MKR, get LPs for them
		- `_getReserves` -- get the latest reserves, updated from `balanceOf`
			- pair.getReserves() -- cached balanceOf
				- https://docs.uniswap.org/contracts/v2/reference/smart-contracts/pair#getreserves
					- Returns the reserves of token0 and token1 used to price trades and distribute liquidity. See [Pricing](https://docs.uniswap.org/contracts/v2/concepts/advanced-topics/pricing). Also returns the `block.timestamp` (mod `2**32`) of the last block during which an interaction occurred for the pair.
					- https://github.com/Uniswap/v2-core/blob/ee547b17853e71ed4e0101ccfd52e70d5acded58/contracts/UniswapV2Pair.sol#L38-L42
			- pair.sync -- save balanceOf to reserves
				- https://docs.uniswap.org/whitepaper.pdf
					- 3.2.2 sync() and skim()
					- To protect against bespoke token implementations that can update the pair contract’s balance, and to more gracefully handle tokens whose total supply can be greater than 2112, Uniswap v2 has two bail-out functions: sync() and skim().
					- sync() functions as a recovery mechanism in the case that a token asynchronously deflates the balance of a pair. In this case, trades will receive sub-optimal rates, and if no liquidity provider is willing to rectify the situation, the pair is stuck. sync() exists to set the reserves of the contract to the current balances, providing a somewhat graceful recovery from this situation.
				- code: just call `_update` with balanceOf
					- https://github.com/Uniswap/v2-core/blob/ee547b17853e71ed4e0101ccfd52e70d5acded58/contracts/UniswapV2Pair.sol#L198-L200
					- https://github.com/Uniswap/v2-core/blob/ee547b17853e71ed4e0101ccfd52e70d5acded58/contracts/UniswapV2Pair.sol#L73-L86
		- `_getDaiToSell(lot, _reserveDai)` -- we want to sell exactly 50% DAI->GEM, but it will move the price. So we need to adjust that after the sell to ensure we have 50% DAI, 50% GEM and supply perfect LP amounts, with no returns
			- lot -- `burn` part (set in splitter_ of fixed lot size set by vow
				- `vow.bump * Splitter.burn`
			- comment
				- // The Uniswap invariant needs to hold through the swap. -- xy=k
				- // Additionally, the deposited funds need to be in the same ratio as the reserves after the swap. -- first we do a swap to get GEM. Then we want to deposit in exact proportion, without anything left
				- // (1) reserveDai * reserveGem = (reserveDai + sell * 997 / 1000) * (reserveGem - bought) -- oldK === newK
					- 997 because of fee 0.3%
					- `DAI*GEM = (DAI + (sellDai - fee)) * (GEM - boughtGem)`
					- => `DAI*GEM = (DAI + soldDai) * (GEM - boughtGem)`
					- => oldK === newK
				- // (2) (lot - sell) / bought = (reserveDai + sell) / (reserveGem - bought) -- Flapper's DAI and GEM balances (after sale) are equal in value for new UniV2Pool prices
					- lot -- all DAI
					- lot - sell -- remaining DAI, ~50%
					- => `leftDAI/boughtGEM = newDAI / newGEM`
					- => leftDAI == boughtGEM in new UniV2 prices
				- // The solution for these equations for variables `sell` and `bought` is used below. -- `_getDaiToSell` tries to solve both (system of equations)
			- (Babylonian.sqrt(reserveDai * (lot * 3_988_000 + reserveDai * 3_988_009)) - reserveDai * 1997) / 1994;
				- Maybe later in [[#^FlapperUniV2-formula]]
		- `_getAmountOut` -- rewritten constant product formula `(x+dx)(y-dy)=k` to get `dy` ^FlapperUniV2--getAmountOut
				- `amtOut = _amtInFee * reserveOut / (reserveIn * 1000 + _amtInFee);`
				- x - DAI, y - MKR/GEM
				- `dy = dx * y / (x + dx)` -- last on the screenshot
				- https://www.youtube.com/watch?v=EIIfavUFnM4&t=718s -- too basic
				- https://www.youtube.com/watch?v=IL7cRj5vzEU -- good
					- ![[static/Pasted image 20240719124652.png]]
		- [[#^FlapperUniV2SwapOnly--sufficient-buy-amount]]
		- `pair.swap(_amt0Out, _amt1Out, address(this), new bytes(0));` -- get MKR (DAI `transfer` just above)
		- UniswapV2Pair.mint -- low-level mint, no returns
			- is `_mintFee` set? -- not now
			- Does `mint` return surplus? -- nope
- Splitter
	- Qs
		- Who calls it? -- user -> vow.flap -> flapper(Splitter).kick
			- dss.vow
				- vow kicks flop and flap on schema https://github.com/makerdao/dss/wiki
			- mom only to stop
		- `flapper` burn DAI? -- The underlying burner strategy (e.g., the address of `FlapperUniV2SwapOnly`).
		- burn engine? -- probably FlapperUniV2* contracts
		- `hop` - Minimum seconds interval between kicks.
		- `vow.bump` -- Flap fixed lot size
	- kick -- `vat.dai`: `vow` => Splitter => DaiJoin =(mint ERC20 DAI)=> FlapperUniV2 & Farm; trigger flapper; trigger farm
		- `vat.move(msg.sender, address(this), tot);` -- transfer `vat.dai` from msg.sender (vow) to Splitter (this)
			- [[#^vat-move]]
		- `uint256 lot = tot * burn / RAD; if (lot > 0) {` when? -- when burn is set to 0 (or rounding, but it has vat.bump (minimal lot), so only 0)
		- `DaiJoinLike(daiJoin).exit(address(flapper), lot);` -- lock Splitter's `vat.dai` balance on DaiJoin, mint ERC20 DAI to flapper(`FlapperUniV2*`)
			- code https://github.com/makerdao/dss/blob/master/src/join.sol#L169-L174
			- same as [[#^NstJoin-exit]]
			- How can we have any `vat.dai` on `FlapperUniV2`
				- Surplus `vat.dai` goes on `vow`, when it's enough `vow` can `kick` splitter, splitter gets `vat.dai`
				- Oh, `.exit` gets `vat.dai` from `msg.sender`, Splitter
- FlapperUniV2SwapOnly -- buy MKR for DAI
	- exec -- just buy MKR, but limit the price by 2% of the oracle's price
		- `buy >= lot * want / (uint256(pip.read()) * RAY / spotter.par())` -- buy >= 98% of lot(collateral=MKR) value in DAI ^FlapperUniV2SwapOnly--sufficient-buy-amount
			- uint256(pip.read()) * RAY / spotter.par()
				- priceInUoV / DaiToUov => priceInDai
			- lot -- amount to sell, collateral, MKR
			- want -- 98%, we don't allow less than that
			- pip.read() / spotter.par -- get MKR price in DAI
				- pip.read() -- returns the current (not next, so a little old) feed value in UoV; reverts if it was not set by some valid mechanism [code](https://github.com/makerdao/osm/blob/master/src/osm.sol#L150-L153) ^pip-read
				- spotter.par -- the relationship between DAI and 1 UoV in the price. [[#^spotter]]
- Maybe

	- `_getDaiToSell` formula -- looks like you need to go too deep and solve a system ^FlapperUniV2-formula
		- CGpt: 
			~~~
			Certainly, I'll explain how the formula in the `_getDaiToSell` function was derived. Let's break it down step by step:
			
			1. First, let's recall the two equations mentioned in the comments:
			
			   (1) reserveDai * reserveGem = (reserveDai + sell * 997 / 1000) * (reserveGem - bought)
			   (2) (lot - sell) / bought = (reserveDai + sell) / (reserveGem - bought)
			
			2. These equations represent the Uniswap invariant and the ratio of reserves after the swap, respectively.
			
			3. To solve for `sell`, we need to eliminate `bought` from these equations and solve for `sell`.
			
			4. From equation (2), we can express `bought` in terms of other variables:
			   bought = (lot - sell) * (reserveGem - bought) / (reserveDai + sell)
			
			5. Substituting this into equation (1):
			   reserveDai * reserveGem = (reserveDai + sell * 997 / 1000) * (reserveGem - (lot - sell) * (reserveGem - bought) / (reserveDai + sell))
			
			6. This equation is quite complex, but it can be simplified and rearranged into a quadratic equation in terms of `sell`.
			
			7. After simplification and rearrangement (which involves several algebraic steps), we get a quadratic equation of the form:
			   a * sell^2 + b * sell + c = 0
			
			   Where:
			   a = 1994
			   b = 1997 * reserveDai
			   c = -reserveDai * (lot * 3988000 + reserveDai * 3988009)
			
			8. The solution to this quadratic equation is given by the quadratic formula:
			   sell = (-b + sqrt(b^2 - 4ac)) / (2a)
			
			9. Substituting the values of a, b, and c:
			   sell = (-1997 * reserveDai + sqrt((1997 * reserveDai)^2 - 4 * 1994 * (-reserveDai * (lot * 3988000 + reserveDai * 3988009)))) / (2 * 1994)
			
			10. Simplifying this expression (factoring out reserveDai from under the square root):
				sell = (sqrt(reserveDai * (lot * 3988000 + reserveDai * 3988009)) - reserveDai * 1997) / 1994
			
			This is exactly the formula we see in the `_getDaiToSell` function:
			
			```solidity
			sell = (Babylonian.sqrt(reserveDai * (lot * 3_988_000 + reserveDai * 3_988_009)) - reserveDai * 1997) / 1994;
			```
			
			The `Babylonian.sqrt` function is used to calculate the square root, and the constants have been slightly adjusted (3_988_000 instead of 3988000) for readability, but the formula is essentially the same.
			
			This derivation involves complex algebraic manipulations and simplifications, which is why the resulting formula looks quite different from the original equations. The goal was to find an efficient way to calculate the amount of DAI to sell given the lot size and the current DAI reserve.
			~~~
## dog.bark 
^dog-bark
- [[#^dog--tab]]
- [[#^dog-bark--vat-grab]]
- [[#^dog-bark--dart]]
- [[#^dog-bark--dink]]
## **How does liquidation work here?** Funds movement 
^funds-movement-on-liquidation

- **MKR**
  - **default** -- seats on LSE or chief after `LSE.lock`
  - **dog.bark** -- chief => VD => LSE
    - >self: noop; ink to clip
    - [[#^dog-bark]]
    - [[#^dog-bark--vat-grab]]
    - **LSClipper.kick** -- chief => VD => LSE
      - > self: noop
      - LSE.onKick -- chief => VD => LSE
  - **LSClipper.take** -- LSE => taker && LSE => `burn` (15% of `sold`) 
    - vat.slip -- noop; reduce gem
    - LSE.onTake -- LSE => providedByTaker
    - vat.move -- noop; only dai
    - dog.digs -- noop; global dirt/Dirt
    - engine.onRemove -- burn 15% of `sold`
- **vat.urn.ink / vat.gem**
  - **default** -- seats on `vat.urns[LSUrn].ink`
  - **dog.bark** -- `vat.urns[LSUrn].ink-` => `vat.gem[LSClipper]+`
    - [[#^dog-bark--vat-grab]] -- `vat.urns[LSUrn].ink-` => `vat.gem[LSClipper]+`
    - **LSClipper.kick** -- noop
      - vat.suck -- noop
      - LSE.onKick -- noop
  - **LSClipper.take** -- `vat.gem[LSClipper]-` (`slice` (bought amt)) && `vat.urns[LSUrn].ink+` (`refund`)
    - vat.slip -- `vat.gem[LSClipper]` - `slice` (bought amt)
    - LSE.onTake -- noop
    - vat.move -- noop
    - dog.digs -- noop; global dirt/Dirt
    - engine.onRemove -- increase `vat.urns[LSUrn].ink` on `refund` [[#^LSE-onRemove--slip-plus-frob]]
- **vat.dai / vat.urn.art / vat.sin**
  - **default** -- seats on `vat.urns[LSUrn].art`
  - **dog.bark** -- `vat.urns[LSUrn].art-` = (`dart`) > `vat.sin[vow]+` && `vat.sin[vow]+` = (coin) > `vat.dai[kpr]+`
    - [[#^dog-bark--vat-grab]] -- `vat.urns[LSUrn].art-` => (`vat.gem[LSClip]` && `vat.sin[vow]+`)
      - dart = (whole urn or systemLimitLeft)
    - **LSClipper.kick** -- `vat.sin[vow]+` => `vat.dai[kpr]+`
      - vat.suck -- `vat.sin[vow]+` => `vat.dai[kpr]+`
      - LSE.onKick -- noop
  - **LSClipper.take** -- `vat.dai[taker]` = (owe) > `vat.dai[vow]`
    - vat.slip -- noop
    - LSE.onTake -- noop
    - vat.move -- `vat.dai[taker]` = (owe) > `vat.dai[vow]`
      - owe = paid
    - dog.digs -- noop; global dirt/Dirt
    - engine.onRemove -- noop
- **lsMKR**
  - **default** -- on LSUrn or Farm
  - **dog.bark** -- Farm = (dink) > LSUrn = (dink) > `burn`
    - amt: dink (dog.bark) => lot (kick) => wad (onKick)
    - [[#^dog-bark--vat-grab]] -- noop
    - **LSClipper.kick** -- Farm => LSUrn => `burn`
      - vat.suck -- noop
      - LSE.onKick -- Farm => LSUrn => `burn`
  - **LSClipper.take** -- `mint` = (refund) > LSUrn
    - vat.slip -- noop
    - LSE.onTake -- noop
    - vat.move -- noop
    - dog.digs -- noop
    - engine.onRemove -- `mint` = (refund) > LSUrn
- **DAI** -- mints in [DaiJoin](https://vscode.blockscan.com/ethereum/0x9759a6ac90977b93b58547b4a71c78317f391a28).[exit](https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/join.sol#L169-L174) using vat.move (change vat.dai[src] => [dst])

---