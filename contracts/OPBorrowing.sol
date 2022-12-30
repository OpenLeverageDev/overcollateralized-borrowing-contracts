// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.0 <0.9.0;

import "./common/DelegateInterface.sol";
import "./common/Adminable.sol";
import "./common/ReentrancyGuard.sol";
import "./IOPBorrowing.sol";
import "./libraries/TransferHelper.sol";
import "./libraries/DexData.sol";
import "./libraries/Utils.sol";

import "./OPBorrowingLib.sol";

contract OPBorrowing is DelegateInterface, Adminable, ReentrancyGuard, IOPBorrowing, OPBorrowingStorage {
    using TransferHelper for IERC20;
    using DexData for bytes;

    constructor(OpenLevInterface _openLev,
        ControllerInterface _controller,
        DexAggregatorInterface _dexAgg,
        XOLEInterface _xOLE,
        address _wETH) OPBorrowingStorage(_openLev, _controller, _dexAgg, _xOLE, _wETH) {
    }
    function initialize(
        MarketConf memory _marketDefConf,
        LiquidationConf memory _liquidationConf) external override onlyAdmin{
        marketDefConf = _marketDefConf;
        liquidationConf = _liquidationConf;
    }

    function addMarket(uint16 marketId, LPoolInterface pool0, LPoolInterface pool1, bytes memory dexData) external override {
        require(msg.sender == address(controller), "NCN");
        Market memory market = Market(pool0, pool1, pool0.underlying(), pool1.underlying(), dexData.toDexDetail());
        // init market info
        markets[marketId] = market;
        // init default config
        marketsConf[marketId] = marketDefConf;
        // init liquidity
        (uint token0Liq, uint token1Liq) = dexAgg.getPairLiquidity(market.token0, market.token1, dexData);
        twaLiquidity[marketId] = Liquidity(token0Liq, token1Liq);
        // approve the max number for pools
        OPBorrowingLib.safeApprove(IERC20(market.token0), address(pool0), type(uint256).max);
        OPBorrowingLib.safeApprove(IERC20(market.token1), address(pool1), type(uint256).max);
        emit NewMarket(marketId, pool0, pool1, market.token0, market.token1, dexData.toDexDetail(), token0Liq, token1Liq);
    }

    struct BorrowVars {
        address collateralToken;
        address borrowToken;
        LPoolInterface borrowPool;
        uint collateralTotalReserve;
        uint collateralTotalShare;
        uint borrowTotalReserve;
        uint borrowTotalShare;
    }

    function borrow(uint16 marketId, bool collateralIndex, uint collateral, uint borrowing) external payable override nonReentrant {
        address borrower = msg.sender;
        controller.collBorrowAllowed(marketId, borrower, collateralIndex);
        // update borrower last block number
        updateBorrowerBlockNum(borrower, marketId, collateralIndex);

        Borrow storage accBorrow = activeBorrows[borrower][marketId][collateralIndex];

        BorrowVars memory borrowVars = toBorrowVars(marketId, collateralIndex);

        MarketConf storage marketConf = marketsConf[marketId];
        collateral = OPBorrowingLib.transferIn(borrower, IERC20(borrowVars.collateralToken), wETH, collateral);

        if (collateral > 0) {
            // amount to share
            collateral = OPBorrowingLib.amountToShare(collateral, borrowVars.collateralTotalShare, borrowVars.collateralTotalReserve);
            increaseCollateralShare(accBorrow, borrowVars.collateralToken, collateral);
        }
        require(collateral > 0 || borrowing > 0, "BE0");
        uint fees = 0;
        if (borrowing > 0) {
            uint borrowed = OPBorrowingLib.borrowBehalf(borrowVars.borrowPool, borrowVars.borrowToken, borrower, borrowing);
            // check pool's liquidity * maxLiquidityRatio >= totalBorrow
            uint borrowTWALiquidity = collateralIndex ? twaLiquidity[marketId].token0Liq : twaLiquidity[marketId].token1Liq;
            bytes memory dexData = OPBorrowingLib.uint32ToBytes(markets[marketId].dex);
            uint borrowLiquidity = dexAgg.getToken0Liquidity(borrowVars.borrowToken, borrowVars.collateralToken, dexData);
            uint minLiquidity = Utils.minOf(borrowTWALiquidity, borrowLiquidity);
            require((minLiquidity * marketConf.maxLiquidityRatio) / RATIO_DENOMINATOR >= borrowVars.borrowPool.totalBorrows(), "BGL");
            // check healthy
            uint accountTotalBorrowed = OPBorrowingLib.borrowStored(borrowVars.borrowPool, borrower);
            require(
                checkHealthy(
                    marketId,
                    OPBorrowingLib.shareToAmount(accBorrow.collateral, totalShares[borrowVars.collateralToken], OPBorrowingLib.balanceOf(IERC20(borrowVars.collateralToken))),
                    accountTotalBorrowed,
                    borrowVars.collateralToken,
                    borrowVars.borrowToken
                ),
                "BNH"
            );
            // collect fees
            fees = collectBorrowFee(marketId, collateralIndex, borrowing, borrowVars.borrowToken, borrowVars.borrowPool, borrowVars.borrowTotalReserve, borrowVars.borrowTotalShare);
            // transfer out borrowing - fees
            OPBorrowingLib.doTransferOut(borrower, IERC20(borrowVars.borrowToken), wETH, borrowed - fees);
        }

        emit CollBorrow(borrower, marketId, collateralIndex, collateral, borrowing, fees);
    }

    function repay(uint16 marketId, bool collateralIndex, uint repayAmount, bool isRedeem) external payable override nonReentrant {
        address borrower = msg.sender;
        controller.collRepayAllowed(marketId);
        // update borrower last block number
        updateBorrowerBlockNum(borrower, marketId, collateralIndex);

        Borrow storage accBorrow = activeBorrows[borrower][marketId][collateralIndex];

        BorrowVars memory borrowVars = toBorrowVars(marketId, collateralIndex);

        uint borrowPrior = borrowVars.borrowPool.borrowBalanceCurrent(borrower);
        if (repayAmount == type(uint256).max) {
            repayAmount = borrowPrior;
        }
        repayAmount = OPBorrowingLib.transferIn(borrower, IERC20(borrowVars.borrowToken), wETH, repayAmount);
        require(repayAmount > 0, "RL0");
        // repay
        OPBorrowingLib.repay(borrowVars.borrowPool, borrower, repayAmount);
        uint borrowAfterRepay = OPBorrowingLib.borrowStored(borrowVars.borrowPool, borrower);
        // in the tax token case, should get actual repay amount
        repayAmount = borrowPrior - borrowAfterRepay;
        uint redeemShare;
        // borrow is 0, so return all collateral
        if (borrowAfterRepay == 0) {
            redeemShare = accBorrow.collateral;
            decreaseCollateralShare(accBorrow, borrowVars.collateralToken, redeemShare);
            OPBorrowingLib.doTransferOut(borrower, IERC20(borrowVars.collateralToken), wETH, OPBorrowingLib.shareToAmount(redeemShare, borrowVars.collateralTotalShare, borrowVars.collateralTotalReserve));
        }
        // redeem collateral= borrower.collateral * repayRatio
        else if (isRedeem) {
            uint repayRatio = (repayAmount * 100000) / borrowPrior;
            redeemShare = (accBorrow.collateral * repayRatio) / 100000;
            redeemInternal(borrower, marketId, collateralIndex, redeemShare, borrowAfterRepay, borrowVars);
        }
        emit CollRepay(borrower, marketId, collateralIndex, repayAmount, redeemShare);
    }

    function redeem(uint16 marketId, bool collateralIndex, uint collateral) external override nonReentrant {
        address borrower = msg.sender;
        controller.collRedeemAllowed(marketId);
        // update borrower last block number
        updateBorrowerBlockNum(borrower, marketId, collateralIndex);

        BorrowVars memory borrowVars = toBorrowVars(marketId, collateralIndex);

        uint borrowPrior = borrowVars.borrowPool.borrowBalanceCurrent(borrower);

        redeemInternal(borrower, marketId, collateralIndex, collateral, borrowPrior, borrowVars);

        emit CollRedeem(borrower, marketId, collateralIndex, collateral);
    }

    struct LiquidateVars {
        uint collateralAmount;
        uint borrowing;
        uint liquidationAmount;
        uint liquidationShare;
        uint liquidationFees;
        bool isPartialLiquidate;
        bytes dexData;
        bool buySuccess;
        uint repayAmount;
        uint buyAmount;
        uint price0;
        uint collateralReturns;
        uint outstandingAmount;
    }

    function liquidate(uint16 marketId, bool collateralIndex, address borrower) external override nonReentrant {
        controller.collLiquidateAllowed(marketId);
        // update borrower last block number
        updateBorrowerBlockNum(borrower, marketId, collateralIndex);

        Borrow storage accBorrow = activeBorrows[borrower][marketId][collateralIndex];
        BorrowVars memory borrowVars = toBorrowVars(marketId, collateralIndex);
        LiquidateVars memory liquidateVars;
        liquidateVars.borrowing = borrowVars.borrowPool.borrowBalanceCurrent(borrower);
        liquidateVars.collateralAmount = OPBorrowingLib.shareToAmount(accBorrow.collateral, borrowVars.collateralTotalShare, borrowVars.collateralTotalReserve);
        // check liquidable
        require(checkLiquidable(marketId, liquidateVars.collateralAmount, liquidateVars.borrowing, borrowVars.collateralToken, borrowVars.borrowToken), "BIH");
        // check msg.sender xOLE
        require(xOLE.balanceOf(msg.sender) >= liquidationConf.liquidatorXOLEHeld, "XNE");
        // compute liquidation collateral
        MarketConf storage marketConf = marketsConf[marketId];
        liquidateVars.liquidationAmount = liquidateVars.collateralAmount;
        liquidateVars.liquidationShare = accBorrow.collateral;
        liquidateVars.dexData = OPBorrowingLib.uint32ToBytes(markets[marketId].dex);
        // avoids stack too deep errors
        {
            uint collateralLiquidity = dexAgg.getToken0Liquidity(borrowVars.collateralToken, borrowVars.borrowToken, liquidateVars.dexData);
            uint maxLiquidity = (collateralLiquidity * marketConf.liquidateMaxLiquidityRatio) / RATIO_DENOMINATOR;
            if (liquidateVars.collateralAmount >= maxLiquidity) {
                liquidateVars.liquidationShare = liquidateVars.liquidationShare / 2;
                liquidateVars.liquidationAmount = OPBorrowingLib.shareToAmount(liquidateVars.liquidationShare, borrowVars.collateralTotalShare, borrowVars.collateralTotalReserve);
                liquidateVars.isPartialLiquidate = true;
            }
        }
        (liquidateVars.price0,) = dexAgg.getPrice(markets[marketId].token0, markets[marketId].token1, liquidateVars.dexData);
        // compute sell collateral amount, borrowings + liquidationFees + tax
        {
            uint24 borrowTokenTransTax = openLev.taxes(marketId, borrowVars.borrowToken, 0);
            uint24 borrowTokenBuyTax = openLev.taxes(marketId, borrowVars.borrowToken, 2);
            uint24 collateralSellTax = openLev.taxes(marketId, borrowVars.collateralToken, 1);

            liquidateVars.repayAmount = Utils.toAmountBeforeTax(liquidateVars.borrowing, borrowTokenTransTax);
            liquidateVars.liquidationFees = (liquidateVars.borrowing * marketConf.liquidateFeesRatio) / RATIO_DENOMINATOR;
            OPBorrowingLib.safeApprove(IERC20(borrowVars.collateralToken), address(dexAgg), liquidateVars.liquidationAmount);
            (liquidateVars.buySuccess,) = address(dexAgg).call(
                abi.encodeWithSelector(
                    dexAgg.buy.selector,
                    borrowVars.borrowToken,
                    borrowVars.collateralToken,
                    borrowTokenBuyTax,
                    collateralSellTax,
                    liquidateVars.repayAmount + liquidateVars.liquidationFees,
                    liquidateVars.liquidationAmount,
                    liquidateVars.dexData
                )
            );
        }
        /*
         * if buySuccess==true, repay all debts and returns collateral
         */
        if (liquidateVars.buySuccess) {
            uint sellAmount = OPBorrowingLib.balanceOf(IERC20(borrowVars.collateralToken)) - borrowVars.collateralTotalReserve;
            liquidateVars.collateralReturns = liquidateVars.collateralAmount - sellAmount;
            liquidateVars.buyAmount = OPBorrowingLib.balanceOf(IERC20(borrowVars.borrowToken)) - borrowVars.borrowTotalReserve;
            OPBorrowingLib.repay(borrowVars.borrowPool, borrower, liquidateVars.repayAmount);
            require(OPBorrowingLib.borrowStored(borrowVars.borrowPool, borrower) == 0, "BG0");
            // collect liquidation fees
            liquidateVars.liquidationFees = liquidateVars.buyAmount - liquidateVars.repayAmount;
            liquidateVars.liquidationShare = accBorrow.collateral;
        }
        /*
         * if buySuccess==false and isPartialLiquidate==true, sell liquidation amount and repay with buyAmount
         * if buySuccess==false and isPartialLiquidate==false, sell liquidation amount and repay with buyAmount + insurance
         */
        else {
            liquidateVars.buyAmount = dexAgg.sell(borrowVars.borrowToken, borrowVars.collateralToken, liquidateVars.liquidationAmount, 0, liquidateVars.dexData);
            liquidateVars.liquidationFees = (liquidateVars.buyAmount * marketConf.liquidateFeesRatio) / RATIO_DENOMINATOR;
            if (liquidateVars.isPartialLiquidate) {
                liquidateVars.repayAmount = liquidateVars.buyAmount - liquidateVars.liquidationFees;
                OPBorrowingLib.repay(borrowVars.borrowPool, borrower, liquidateVars.repayAmount);
                require(OPBorrowingLib.borrowStored(borrowVars.borrowPool, borrower) != 0, "BE0");
            } else {
                uint insuranceShare = collateralIndex ? insurances[marketId].insurance0 : insurances[marketId].insurance1;
                uint insuranceAmount = OPBorrowingLib.shareToAmount(insuranceShare, borrowVars.borrowTotalShare, borrowVars.borrowTotalReserve);
                uint diffRepayAmount = liquidateVars.repayAmount + liquidateVars.liquidationFees - liquidateVars.buyAmount;
                uint insuranceDecrease;
                if (insuranceAmount >= diffRepayAmount) {
                    OPBorrowingLib.repay(borrowVars.borrowPool, borrower, liquidateVars.repayAmount);
                    insuranceDecrease = OPBorrowingLib.amountToShare(diffRepayAmount, borrowVars.borrowTotalShare, borrowVars.borrowTotalReserve);
                } else {
                    liquidateVars.repayAmount = liquidateVars.buyAmount + insuranceAmount - liquidateVars.liquidationFees;
                    borrowVars.borrowPool.repayBorrowEndByOpenLev(borrower, liquidateVars.repayAmount);
                    liquidateVars.outstandingAmount = diffRepayAmount - insuranceAmount;
                    insuranceDecrease = insuranceShare;
                }
                decreaseInsuranceShare(insurances[marketId], !collateralIndex, borrowVars.borrowToken, insuranceDecrease);
            }
        }
        collectLiquidationFee(marketId, collateralIndex, liquidateVars.liquidationFees, borrowVars.borrowToken, borrowVars.borrowPool, borrowVars.borrowTotalReserve, borrowVars.borrowTotalShare);
        decreaseCollateralShare(accBorrow, borrowVars.collateralToken, liquidateVars.liquidationShare);
        if (liquidateVars.collateralReturns > 0) {
            OPBorrowingLib.doTransferOut(borrower, IERC20(borrowVars.collateralToken), wETH, liquidateVars.collateralReturns);
        }
        emit CollLiquidate(borrower, marketId, collateralIndex, msg.sender, liquidateVars.liquidationShare, liquidateVars.repayAmount, liquidateVars.outstandingAmount, liquidateVars.liquidationFees, liquidateVars.price0);
    }

    /*** Admin Functions ***/
    function migrateOpenLevMarkets(uint16 from, uint16 to) external override onlyAdmin {
        for (uint16 i = from; i <= to; i++) {
            OpenLevInterface.Market memory market = openLev.markets(i);
            markets[i] = Market(LPoolInterface(market.pool0), LPoolInterface(market.pool1), market.token0, market.token1, openLev.getMarketSupportDexs(i)[0]);
        }
    }

    function setTwaLiquidity(uint16[] calldata marketIds, OPBorrowingStorage.Liquidity[] calldata liquidity) external override onlyAdminOrDeveloper {
        require(marketIds.length == liquidity.length, "IIL");
        for (uint i = 0; i < marketIds.length; i++) {
            uint16 marketId = marketIds[i];
            uint oldToken0Liq = twaLiquidity[marketId].token0Liq;
            uint oldToken1Liq = twaLiquidity[marketId].token1Liq;
            twaLiquidity[marketId] = liquidity[i];
            emit NewLiquidity(marketId, oldToken0Liq, oldToken1Liq, liquidity[i].token0Liq, liquidity[i].token1Liq);
        }
    }

    function setMarketDefConf(OPBorrowingStorage.MarketConf calldata _marketConf) external override onlyAdmin {
        marketDefConf = _marketConf;
    }

    function setMarketConf(uint16 marketId, OPBorrowingStorage.MarketConf calldata _marketConf) external override onlyAdmin {
        marketsConf[marketId] = _marketConf;
        emit NewMarketConf(
            marketId,
            _marketConf.collateralRatio,
            _marketConf.maxLiquidityRatio,
            _marketConf.borrowFeesRatio,
            _marketConf.insuranceRatio,
            _marketConf.poolReturnsRatio,
            _marketConf.liquidateFeesRatio,
            _marketConf.liquidatorReturnsRatio,
            _marketConf.liquidateInsuranceRatio,
            _marketConf.liquidatePoolReturnsRatio,
            _marketConf.liquidateMaxLiquidityRatio,
            _marketConf.twapDuration
        );
    }

    function setLiquidationConf(OPBorrowingStorage.LiquidationConf calldata _liquidationConf) external override onlyAdmin {
        liquidationConf = _liquidationConf;
    }

    function moveInsurance(uint16 marketId, bool poolIndex, address to, uint moveShare) external override onlyAdmin {
        address token;
        if (!poolIndex) {
            insurances[marketId].insurance0 -= moveShare;
            token = markets[marketId].token0;
        } else {
            insurances[marketId].insurance1 -= moveShare;
            token = markets[marketId].token1;
        }
        uint256 totalShare = totalShares[token];
        totalShares[token] = totalShare - moveShare;
        OPBorrowingLib.safeTransfer(IERC20(token), to, OPBorrowingLib.shareToAmount(moveShare, totalShare, OPBorrowingLib.balanceOf(IERC20(token))));
    }

    function redeemInternal(address borrower, uint16 marketId, bool collateralIndex, uint redeemShare, uint borrowing, BorrowVars memory borrowVars) internal {
        Borrow storage accBorrow = activeBorrows[borrower][marketId][collateralIndex];
        require(accBorrow.collateral >= redeemShare, "RGC");
        decreaseCollateralShare(accBorrow, borrowVars.collateralToken, redeemShare);
        // redeem
        OPBorrowingLib.doTransferOut(borrower, IERC20(borrowVars.collateralToken), wETH, OPBorrowingLib.shareToAmount(redeemShare, borrowVars.collateralTotalShare, borrowVars.collateralTotalReserve));
        // check healthy
        require(
            checkHealthy(
                marketId,
                OPBorrowingLib.shareToAmount(accBorrow.collateral, totalShares[borrowVars.collateralToken], OPBorrowingLib.balanceOf(IERC20(borrowVars.collateralToken))),
                borrowing,
                borrowVars.collateralToken,
                borrowVars.borrowToken
            ),
            "BNH"
        );
    }

    function increaseCollateralShare(Borrow storage accBorrow, address token, uint increaseShare) internal {
        accBorrow.collateral += increaseShare;
        totalShares[token] += increaseShare;
    }

    function decreaseCollateralShare(Borrow storage accBorrow, address token, uint decreaseShare) internal {
        accBorrow.collateral -= decreaseShare;
        totalShares[token] -= decreaseShare;
    }

    function increaseInsuranceShare(Insurance storage insurance, bool index, address token, uint increaseShare) internal {
        if (!index) {
            insurance.insurance0 += increaseShare;
        } else {
            insurance.insurance1 += increaseShare;
        }
        totalShares[token] += increaseShare;
    }

    function decreaseInsuranceShare(Insurance storage insurance, bool index, address token, uint decreaseShare) internal {
        if (!index) {
            insurance.insurance0 -= decreaseShare;
        } else {
            insurance.insurance1 -= decreaseShare;
        }
        totalShares[token] -= decreaseShare;
    }

    function updateBorrowerBlockNum(address borrower, uint16 marketId, bool collateralIndex) internal {
        Borrow storage accBorrow = activeBorrows[borrower][marketId][collateralIndex];
        uint blockNum = block.number;
        require(blockNum != accBorrow.lastBlockNum, "SBN");
        accBorrow.lastBlockNum = uint128(blockNum);
    }

    function collectBorrowFee(uint16 marketId, bool collateralIndex, uint borrowed, address borrowToken, LPoolInterface borrowPool, uint borrowTotalReserve, uint borrowTotalShare) internal returns (uint) {
        MarketConf storage marketConf = marketsConf[marketId];
        uint fees = (borrowed * marketConf.borrowFeesRatio) / RATIO_DENOMINATOR;
        if (fees > 0) {
            uint poolReturns = (fees * marketConf.poolReturnsRatio) / RATIO_DENOMINATOR;
            if (poolReturns > 0) {
                OPBorrowingLib.safeTransfer(IERC20(borrowToken), address(borrowPool), poolReturns);
            }
            uint insurance = (fees * marketConf.insuranceRatio) / RATIO_DENOMINATOR;
            if (insurance > 0) {
                uint increaseInsurance = OPBorrowingLib.amountToShare(insurance, borrowTotalShare, borrowTotalReserve);
                increaseInsuranceShare(insurances[marketId], !collateralIndex, borrowToken, increaseInsurance);
            }
            uint xoleAmount = fees - poolReturns - insurance;
            if (xoleAmount > 0) {
                OPBorrowingLib.safeTransfer(IERC20(borrowToken), address(xOLE), xoleAmount);
            }
        }
        return fees;
    }

    function collectLiquidationFee(uint16 marketId, bool collateralIndex, uint liquidationFees, address borrowToken, LPoolInterface borrowPool, uint borrowTotalReserve, uint borrowTotalShare) internal {
        if (liquidationFees > 0) {
            MarketConf storage marketConf = marketsConf[marketId];
            uint poolReturns = (liquidationFees * marketConf.liquidatePoolReturnsRatio) / RATIO_DENOMINATOR;
            if (poolReturns > 0) {
                OPBorrowingLib.safeTransfer(IERC20(borrowToken), address(borrowPool), poolReturns);
            }
            uint insurance = (liquidationFees * marketConf.liquidateInsuranceRatio) / RATIO_DENOMINATOR;
            if (insurance > 0) {
                uint increaseInsurance = OPBorrowingLib.amountToShare(insurance, borrowTotalShare, borrowTotalReserve);
                increaseInsuranceShare(insurances[marketId], !collateralIndex, borrowToken, increaseInsurance);
            }
            uint liquidatorReturns = (liquidationFees * marketConf.liquidatorReturnsRatio) / RATIO_DENOMINATOR;
            if (liquidatorReturns > 0) {
                OPBorrowingLib.safeTransfer(IERC20(borrowToken), msg.sender, liquidatorReturns);
            }
            // buy back
            uint buyBackAmount = liquidationFees - poolReturns - insurance - liquidatorReturns;
            if (buyBackAmount > 0) {
                OPBorrowingLib.safeApprove(IERC20(borrowToken), address(liquidationConf.buyBack), buyBackAmount);
                liquidationConf.buyBack.transferIn(borrowToken, buyBackAmount);
            }
        }
    }

    function checkHealthy(uint16 marketId, uint collateral, uint borrowed, address collateralToken, address borrowToken) internal returns (bool) {
        if (borrowed == 0) {
            return true;
        }
        MarketConf storage marketConf = marketsConf[marketId];
        // update price
        bytes memory dexData = OPBorrowingLib.uint32ToBytes(markets[marketId].dex);
        uint16 twapDuration = marketConf.twapDuration;
        dexAgg.updatePriceOracle(collateralToken, borrowToken, twapDuration, dexData);
        // check collateral * ratio >= borrowed
        uint collateralPrice;
        uint denominator;
        // avoids stack too deep errors
        {
            (uint price, uint cAvgPrice, uint hAvgPrice, uint8 decimals, uint timestamp) = dexAgg.getPriceCAvgPriceHAvgPrice(collateralToken, borrowToken, twapDuration, dexData);
            // ignore hAvgPrice
            if (block.timestamp > (timestamp + twapDuration)) {
                hAvgPrice = cAvgPrice;
            }
            collateralPrice = Utils.minOf(Utils.minOf(price, cAvgPrice), hAvgPrice);
            denominator = (10 ** uint(decimals));
        }
        return collateral * collateralPrice / denominator * marketConf.collateralRatio / RATIO_DENOMINATOR >= borrowed;
    }

    function checkLiquidable(uint16 marketId, uint collateral, uint borrowed, address collateralToken, address borrowToken) internal returns (bool) {
        if (borrowed == 0) {
            return false;
        }
        MarketConf storage marketConf = marketsConf[marketId];
        // update price
        bytes memory dexData = OPBorrowingLib.uint32ToBytes(markets[marketId].dex);
        uint16 twapDuration = marketConf.twapDuration;
        dexAgg.updatePriceOracle(collateralToken, borrowToken, twapDuration, dexData);
        // check collateral * ratio < borrowed
        uint collateralPrice;
        uint denominator;
        // avoids stack too deep errors
        {
            (uint price, uint cAvgPrice, uint hAvgPrice, uint8 decimals, uint timestamp) = dexAgg.getPriceCAvgPriceHAvgPrice(collateralToken, borrowToken, twapDuration, dexData);
            // ignore hAvgPrice
            if (block.timestamp > (timestamp + twapDuration)) {
                hAvgPrice = cAvgPrice;
            }
            // avoids flash loan
            if (price < cAvgPrice) {
                uint diffPriceRatio = (cAvgPrice * 100) / price;
                require(diffPriceRatio - 100 <= liquidationConf.priceDiffRatio, "MPT");
            }
            collateralPrice = Utils.maxOf(Utils.maxOf(price, cAvgPrice), hAvgPrice);
            denominator = (10 ** uint(decimals));
        }
        return collateral * collateralPrice / denominator * marketConf.collateralRatio / RATIO_DENOMINATOR < borrowed;
    }

    function toBorrowVars(uint16 marketId, bool collateralIndex) internal view returns (BorrowVars memory) {
        BorrowVars memory borrowVars;
        borrowVars.collateralToken = collateralIndex ? markets[marketId].token1 : markets[marketId].token0;
        borrowVars.borrowToken = collateralIndex ? markets[marketId].token0 : markets[marketId].token1;
        borrowVars.borrowPool = collateralIndex ? markets[marketId].pool0 : markets[marketId].pool1;
        borrowVars.collateralTotalReserve = OPBorrowingLib.balanceOf(IERC20(borrowVars.collateralToken));
        borrowVars.collateralTotalShare = totalShares[borrowVars.collateralToken];
        borrowVars.borrowTotalReserve = OPBorrowingLib.balanceOf(IERC20(borrowVars.borrowToken));
        borrowVars.borrowTotalShare = totalShares[borrowVars.borrowToken];
        return borrowVars;
    }
}
