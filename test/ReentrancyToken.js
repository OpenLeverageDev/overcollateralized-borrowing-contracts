const OPBorrowing = artifacts.require("OPBorrowing");
const OPBorrowingDelegator = artifacts.require("OPBorrowingDelegator");
const MockBuyBack = artifacts.require("MockBuyBack");
const MockController = artifacts.require("MockController");
const MockDexAgg = artifacts.require("MockDexAgg");
const MockLPool = artifacts.require("MockLPool");
const MockOpenLev = artifacts.require("MockOpenLev");
const MockWETH = artifacts.require("MockWETH");
const MockReentrancyToken = artifacts.require("MockReentrancyToken");
const MockToken = artifacts.require("MockToken");
const MockReentrancyHacker = artifacts.require("MockReentrancyHacker");

const MockXOLE = artifacts.require("MockXOLE");
const m = require('mocha-logger');
const {toWei, maxUint, equalBN, gtBN, toBN, percent, toETH} = require("./util/Utils");
const {expectRevert} = require("@openzeppelin/test-helpers");

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
    let poolInitSupply = toWei(10000000);
    let initLiquidity = 1000000;
    let initPrice = 1;
    let market0Id = 0;
    let market0;
    beforeEach(async () => {
        token0 = await MockReentrancyToken.new("Token0", {from: adminAcc});
        token1 = await MockToken.new("Token1", {from: adminAcc});
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

    it("reentrancy token hack unsuccessful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let borrowing = toWei(5000);
        let reentrancyCtr = await MockReentrancyHacker.new();
        await token0.mint(reentrancyCtr.address, collateral);
        await token0.setReentrancy(true, {value: 10000});
        await reentrancyCtr.setOpBorrowing(borrowingCtr.address);
        await reentrancyCtr.setFlag(1);
        await expectRevert(
            reentrancyCtr.borrow(market0Id, collateralIndex, collateral, borrowing),
            "TFF");
        await reentrancyCtr.setFlag(2);
        await expectRevert(
            reentrancyCtr.borrow(market0Id, collateralIndex, collateral, borrowing),
            "TFF")
        await reentrancyCtr.setFlag(3);
        await expectRevert(
            reentrancyCtr.borrow(market0Id, collateralIndex, collateral, borrowing),
            "TFF")
        await reentrancyCtr.setFlag(4);
        await expectRevert(
            reentrancyCtr.borrow(market0Id, collateralIndex, collateral, borrowing),
            "TFF")
    })


});