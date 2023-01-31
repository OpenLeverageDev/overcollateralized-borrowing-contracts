const OPBorrowing = artifacts.require("OPBorrowing");
const OPBorrowingDelegator = artifacts.require("OPBorrowingDelegator");
const MockBuyBack = artifacts.require("MockBuyBack");
const MockController = artifacts.require("MockController");
const MockDexAgg = artifacts.require("MockDexAgg");
const MockLPool = artifacts.require("MockLPool");
const MockOpenLev = artifacts.require("MockOpenLev");
const MockToken = artifacts.require("MockToken");
const MockWETH = artifacts.require("MockWETH");
const MockDeflationToken = artifacts.require("MockDeflationToken");

const MockXOLE = artifacts.require("MockXOLE");
const m = require('mocha-logger');
const {toWei, maxUint, equalBN, gtBN, toBN} = require("./util/Utils");

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
        token1 = await MockDeflationToken.new("Token1", {from: adminAcc});
        weth = await MockWETH.new({from: adminAcc});

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
        await token1.mint(lender1, poolInitSupply);
        await token0.approve(pool0.address, poolInitSupply, {from: lender1});
        await token1.approve(pool1.address, poolInitSupply, {from: lender1});
        await pool0.mint(poolInitSupply, {from: lender1});
        await pool1.mint(poolInitSupply, {from: lender1});

    });

    it("borrow token0 and redeem collateral deflationary token with two borrowers successful", async () => {
        let collateral = toWei(1).div(toBN(100));
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(1).div(toBN(400));

        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1, gasPrice: 0});

        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        // active borrows
        equalBN(collateral, collateralOnChain);
        // borrower transfer in
        equalBN(borrowing.mul(toBN(98)).div(toBN(100)), await borrowToken.balanceOf(borrower1));
        // borrower transfer out
        equalBN("0", await collateralToken.balanceOf(borrower1));
        // borrowing
        equalBN(borrowing, await borrowPool.borrowBalanceStored(borrower1));
        let collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("20000", collateralRatio);
        // change deflation ratio
        let deflationRatio = toBN(90);
        await collateralToken.setDeflationRatio(deflationRatio);
        collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("17998", collateralRatio);
        let redeemAmount = collateral.div(toBN(4));
        await borrowingCtr.redeem(market0Id, collateralIndex, redeemAmount, {from: borrower1});
        collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("13497", collateralRatio);
        equalBN(redeemAmount.mul(deflationRatio).div(toBN(100)), await collateralToken.balanceOf(borrower1));
        collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(collateral.sub(redeemAmount), collateralOnChain);
        equalBN(collateralOnChain, await borrowingCtr.totalShares(collateralToken.address));
        await collateralToken.transfer(lender2, await collateralToken.balanceOf(borrower1), {from: borrower1});
        equalBN(0, await collateralToken.balanceOf(borrower1));
        await collateralToken.mint(borrower1, collateral);
        equalBN(collateral, await collateralToken.balanceOf(borrower1));
        // borrow more
        let collateralBefore = collateralOnChain;
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1, gasPrice: 0});
        collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        let totalBalance = await collateralToken.balanceOf(borrowingCtr.address);
        equalBN(collateralBefore.add(collateral.mul(await borrowingCtr.totalShares(collateralToken.address)).div(totalBalance)), collateralOnChain);
        equalBN(collateralOnChain, await borrowingCtr.totalShares(collateralToken.address));
        collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("16745", collateralRatio);
        await collateralToken.setDeflationRatio(toBN(50));
        collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("9302", collateralRatio);
        totalBalance = await collateralToken.balanceOf(borrowingCtr.address);
        // borrower2 borrow
        await collateralToken.mint(borrower2, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower2, gasPrice: 0});
        collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("9300", collateralRatio);
        // borrower1 redeem all
        await borrowToken.mint(borrower1, borrowing.mul(toBN(3)));
        await borrowingCtr.repay(market0Id, collateralIndex, maxUint(), false, {from: borrower1});
        collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(totalBalance, await collateralToken.balanceOf(borrower1));
        equalBN("0",collateralOnChain);
        // check borrower2
        let collateralOnChain2 = await borrowingCtr.activeBorrows(borrower2, market0Id, collateralIndex);
        equalBN("19996", await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower2));
        equalBN("19999999999999998",collateralOnChain2);
        equalBN(collateralOnChain2, await borrowingCtr.totalShares(collateralToken.address));
        equalBN(collateral, await collateralToken.balanceOf(borrowingCtr.address));

    })

    it("liquidate deflationary token successful", async () => {
        let collateral = toWei(1).div(toBN(100));
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(1).div(toBN(400));

        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1, gasPrice: 0});

        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        // active borrows
        equalBN(collateral, collateralOnChain);
        let collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("20000", collateralRatio);
        // change deflation ratio 0.4
        let deflationRatio = toBN(40);
        await collateralToken.setDeflationRatio(deflationRatio);
        collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("7999", collateralRatio);
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        let sellAmount = collateral.div(toBN(4));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(collateral.mul(deflationRatio).div(toBN(100)).sub(sellAmount), await collateralToken.balanceOf(borrower1));
        collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(collateralOnChain, await borrowingCtr.totalShares(collateralToken.address));
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
    })

    it("move deflationary token insurance successful", async () => {
        let collateral = toWei(1).div(toBN(100));
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowing = toWei(1).div(toBN(400));
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        let insurance1 = toBN((await borrowingCtr.insurances(market0Id)).insurance1);
        let moveInsurance = insurance1.div(toBN(4));
        let deflationRatio = toBN(80);
        await borrowToken.setDeflationRatio(deflationRatio);
        await borrowingCtr.moveInsurance(market0Id, true, liquidator, moveInsurance, {from: adminAcc});

        let insuranceAfter = toBN((await borrowingCtr.insurances(market0Id)).insurance1);
        equalBN(insurance1.sub(moveInsurance), insuranceAfter);
        equalBN(insuranceAfter, await borrowingCtr.totalShares(borrowToken.address));
        equalBN(moveInsurance.mul(deflationRatio).div(toBN(100)), await borrowToken.balanceOf(liquidator));
    })

});