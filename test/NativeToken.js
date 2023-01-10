const OPBorrowing = artifacts.require("OPBorrowing");
const OPBorrowingDelegator = artifacts.require("OPBorrowingDelegator");
const MockBuyBack = artifacts.require("MockBuyBack");
const MockController = artifacts.require("MockController");
const MockDexAgg = artifacts.require("MockDexAgg");
const MockLPool = artifacts.require("MockLPool");
const MockOpenLev = artifacts.require("MockOpenLev");
const MockToken = artifacts.require("MockToken");
const MockWETH = artifacts.require("MockWETH");
const MockXOLE = artifacts.require("MockXOLE");
const m = require('mocha-logger');
const {toWei, maxUint, equalBN, gtBN, toBN} = require("./util/Utils");
const {expectRevert} = require("@openzeppelin/test-helpers");
const timeMachine = require('ganache-time-traveler');

contract("OPBorrowing", async accounts => {
    let adminAcc = accounts[0];
    let lender1 = accounts[1];
    let lender2 = accounts[2];
    let borrower1 = accounts[3];
    let borrower2 = accounts[4];
    let liquidator = accounts[5];
    let token0, token1, weth, pool0, pool1;
    let buyBackCtr, controllerCtr, dexAggCtr, openLevCtr, xoleCtr, borrowingCtr;
    let marketConf = [
        5000, //collateralRatio
        1000,//maxLiquidityRatio
        200,//borrowFeesRatio
        4000, //insuranceRatio
        3000,//poolReturnsRatio
        100,//liquidateFeesRatio
        4000, //liquidatorReturnsRatio
        3000,//liquidateInsuranceRatio
        2000, //liquidatePoolReturnsRatio
        1000, //liquidateMaxLiquidityRatio
        60//twapDuration
    ];
    let liquidatorXOLEHeld = 10000;
    let priceDiffRatio = 10;
    let borrowRateOfPerBlock = 1;// 0.01%
    let dexData = "0x02";
    let poolInitSupply = toWei(1).div(toBN(10));
    let initLiquidity = 1000000;
    let initPrice = 1;
    let market0Id = 0;
    let market0;
    beforeEach(async () => {
        token0 = await MockToken.new("Token0", {from: adminAcc});
        token1 = await MockWETH.new({from: adminAcc});
        weth = token1;

        buyBackCtr = await MockBuyBack.new({from: adminAcc});
        controllerCtr = await MockController.new({from: adminAcc});
        dexAggCtr = await MockDexAgg.new({from: adminAcc});
        openLevCtr = await MockOpenLev.new({from: adminAcc});
        xoleCtr = await MockXOLE.new({from: adminAcc});

        borrowingCtr = await OPBorrowing.new(openLevCtr.address, controllerCtr.address, dexAggCtr.address, xoleCtr.address, weth.address, {from: adminAcc});
        let borrowingDelegator = await OPBorrowingDelegator.new(marketConf, [liquidatorXOLEHeld, priceDiffRatio, buyBackCtr.address], adminAcc, borrowingCtr.address, {from: adminAcc});
        borrowingCtr = await OPBorrowing.at(borrowingDelegator.address);
        assert.equal(controllerCtr.address, await borrowingCtr.controller());
        await controllerCtr.setOPBorrowing(borrowingCtr.address, {from: adminAcc});
        await controllerCtr.setBorrowRateOfPerBlock(borrowRateOfPerBlock, {from: adminAcc});
        // init liquidity
        await dexAggCtr.setLiquidity(toWei(initLiquidity), toWei(initLiquidity), {from: adminAcc});
        // init price
        await dexAggCtr.setPrice(initPrice, initPrice, initPrice, 0, {from: adminAcc});
        // create market
        await controllerCtr.createLPoolPair(token0.address, token1.address, 0, dexData, {from: adminAcc});
        market0 = await borrowingCtr.markets(market0Id);
        assert.equal(token0.address, market0.token0);
        assert.equal(token1.address, market0.token1);
        pool0 = await MockLPool.at(market0.pool0);
        pool1 = await MockLPool.at(market0.pool1);
        // approve OPBorrowing contract by borrower
        await token0.approve(borrowingCtr.address, maxUint(), {from: borrower1});
        await token0.approve(borrowingCtr.address, maxUint(), {from: borrower2});
        await token1.approve(borrowingCtr.address, maxUint(), {from: borrower1});
        await token1.approve(borrowingCtr.address, maxUint(), {from: borrower2});
        // deposit in pool
        await token0.mint(lender1, poolInitSupply);
        await token1.mint(lender1, poolInitSupply, {from: lender1, value: poolInitSupply});
        await token0.approve(pool0.address, poolInitSupply, {from: lender1});
        await token1.approve(pool1.address, poolInitSupply, {from: lender1});
        await pool0.mint(poolInitSupply, {from: lender1});
        await pool1.mint(poolInitSupply, {from: lender1});

    });

    it("borrow eth and collateral token0 successful", async () => {
        let collateral = toWei(1).div(toBN(100));
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowPool = pool1;
        let borrowing = toWei(1).div(toBN(400));

        await collateralToken.mint(borrower1, collateral);
        let ethBalanceBefore = await web3.eth.getBalance(borrower1);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1, gasPrice: 0});
        let ethBalanceAfter = await web3.eth.getBalance(borrower1);

        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        // active borrows
        equalBN(collateral, activeBorrows.collateral);
        // borrower transfer in
        equalBN(borrowing.mul(toBN(98)).div(toBN(100)), toBN(ethBalanceAfter).sub(toBN(ethBalanceBefore)));
        // borrower transfer out
        equalBN("0", await collateralToken.balanceOf(borrower1));
        // borrowing
        equalBN(borrowing, await borrowPool.borrowBalanceStored(borrower1));
        equalBN(1, await controllerCtr.borrowCounter());
    })


    it("borrow token0 and collateral eth successful", async () => {
        let collateral = toWei(1).div(toBN(100));
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(1).div(toBN(400));

        await borrowingCtr.borrow(market0Id, collateralIndex, 0, borrowing, {
            from: borrower1,
            gasPrice: 0,
            value: collateral
        });
        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        // active borrows
        equalBN(collateral, activeBorrows.collateral);
        // borrower transfer in
        equalBN(borrowing.mul(toBN(98)).div(toBN(100)), await borrowToken.balanceOf(borrower1));
        // borrower transfer out
        equalBN("0", await collateralToken.balanceOf(borrower1));
        // borrowing
        equalBN(borrowing, await borrowPool.borrowBalanceStored(borrower1));
    })


    it("redeem eth and borrow token0 successful", async () => {
        let collateral = toWei(1).div(toBN(100));
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(1).div(toBN(400));
        await borrowingCtr.borrow(market0Id, collateralIndex, 0, borrowing, {
            from: borrower1,
            gasPrice: 0,
            value: collateral
        });
        let redeemAmount = collateral.div(toBN(4));
        let ethBalanceBefore = await web3.eth.getBalance(borrower1);
        await borrowingCtr.redeem(market0Id, collateralIndex, redeemAmount, {
            from: borrower1,
            gasPrice: 0
        });
        let ethBalanceAfter = await web3.eth.getBalance(borrower1);
        equalBN(redeemAmount, toBN(ethBalanceAfter).sub(toBN(ethBalanceBefore)));

        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(collateral.sub(redeemAmount), activeBorrows.collateral);
        equalBN(activeBorrows.collateral, await borrowingCtr.totalShares(collateralToken.address));
    })

    it("repay eth and collateral token0 successful", async () => {
        let collateral = toWei(1).div(toBN(100));
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(1).div(toBN(400));
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {
            from: borrower1,
            gasPrice: 0
        });
        let repayAmount = borrowing.mul(toBN(101)).div(toBN(100));
        let ethBalanceBefore = await web3.eth.getBalance(borrower1);
        await borrowingCtr.repay(market0Id, collateralIndex, 0, false, {
            from: borrower1,
            gasPrice: 0,
            value: repayAmount
        });
        let ethBalanceAfter = await web3.eth.getBalance(borrower1);
        equalBN(repayAmount, toBN(ethBalanceBefore).sub(toBN(ethBalanceAfter)));

        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, activeBorrows.collateral);
        equalBN(activeBorrows.collateral, await borrowingCtr.totalShares(collateralToken.address));
    })

    it("liquidate eth and borrow token0 successful", async () => {
        let collateral = toWei(1).div(toBN(100));
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;

        let borrowing = toWei(1).div(toBN(200));
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {
            from: borrower1,
            gasPrice: 0,
            value: collateral
        });
        let ethBalanceBefore = await web3.eth.getBalance(borrower1);
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        let sellAmount = collateral.div(toBN(2));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        let ethBalanceAfter = await web3.eth.getBalance(borrower1);
        equalBN(collateral.sub(sellAmount), toBN(ethBalanceAfter).sub(toBN(ethBalanceBefore)));
        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, activeBorrows.collateral);
        equalBN(activeBorrows.collateral, await borrowingCtr.totalShares(collateralToken.address));
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance1);
        equalBN("55004500000000", insurances.insurance0);
        // pool returns
        equalBN("100041503000000000", await borrowPool.totalCash());
        // liquidator returns
        equalBN("20006000000000", await borrowToken.balanceOf(liquidator));
        // total share
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("55004500000000", await borrowingCtr.totalShares(borrowToken.address));
        // buy back contract reserve
        equalBN("5001500000000", await borrowToken.balanceOf(buyBackCtr.address));
        // borrower balance
        equalBN("0", await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token0 and borrow eth successful", async () => {
        let collateral = toWei(1).div(toBN(1000));
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;

        let borrowing = toWei(1).div(toBN(2000));
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {
            from: borrower1,
            gasPrice: 0
        });
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        let sellAmount = collateral.div(toBN(2));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, activeBorrows.collateral);
        equalBN(activeBorrows.collateral, await borrowingCtr.totalShares(collateralToken.address));
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance0);
        equalBN("5500450000000", insurances.insurance1);
        // pool returns
        equalBN("100004150300000000", await borrowPool.totalCash());
        // liquidator returns
        equalBN("2000600000000", await borrowToken.balanceOf(liquidator));
        // total share
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("5500450000000", await borrowingCtr.totalShares(borrowToken.address));
        // buy back contract reserve
        equalBN("500150000000", await borrowToken.balanceOf(buyBackCtr.address));
        // borrower balance
        equalBN(collateral.sub(sellAmount), await collateralToken.balanceOf(borrower1));
    })
});