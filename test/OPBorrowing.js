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
    let poolInitSupply = 1000000;
    let initLiquidity = 1000000;
    let initPrice = 1;
    let market0Id = 0;
    let market0;
    beforeEach(async () => {
        token0 = await MockToken.new("Token0", {from: adminAcc});
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
        await token0.mint(lender1, toWei(poolInitSupply));
        await token1.mint(lender1, toWei(poolInitSupply));
        await token0.approve(pool0.address, toWei(poolInitSupply), {from: lender1});
        await token1.approve(pool1.address, toWei(poolInitSupply), {from: lender1});
        await pool0.mint(toWei(poolInitSupply), {from: lender1});
        await pool1.mint(toWei(poolInitSupply), {from: lender1});

    });

    it("borrow token1 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;
        let borrowing = toWei(2000);

        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        // active borrows
        equalBN(collateral, collateralOnChain);
        // borrower transfer in
        equalBN("1960000000000000000000", await borrowToken.balanceOf(borrower1));
        // borrower transfer out
        equalBN("0", await collateralToken.balanceOf(borrower1));
        // borrowing
        equalBN(borrowing, await borrowPool.borrowBalanceStored(borrower1));
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance0);
        equalBN("16000000000000000000", insurances.insurance1);
        // xole reserve
        equalBN("12000000000000000000", await borrowToken.balanceOf(xoleCtr.address));
        // pool returns
        equalBN("998012000000000000000000", await borrowPool.totalCash());
        // total share
        equalBN("10000000000000000000000", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("16000000000000000000", await borrowingCtr.totalShares(borrowToken.address));
        equalBN("25000", await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1));

        // borrow more
        await borrowingCtr.borrow(market0Id, collateralIndex, 0, borrowing, {from: borrower1});
        collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(collateral, collateralOnChain);
        equalBN("3920000000000000000000", await borrowToken.balanceOf(borrower1));
        equalBN("0", await collateralToken.balanceOf(borrower1));
        equalBN("4000200000000000000000", await borrowPool.borrowBalanceStored(borrower1));
        insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance0);
        equalBN("32000000000000000000", insurances.insurance1);
        equalBN("24000000000000000000", await borrowToken.balanceOf(xoleCtr.address));
        equalBN("996024000000000000000000", await borrowPool.totalCash());
        equalBN("10000000000000000000000", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("32000000000000000000", await borrowingCtr.totalShares(borrowToken.address));
    })

    it("borrow token0 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(2000);

        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        // active borrows
        equalBN(collateral, collateralOnChain);
        // borrower transfer in
        equalBN("1960000000000000000000", await borrowToken.balanceOf(borrower1));
        // borrower transfer out
        equalBN("0", await collateralToken.balanceOf(borrower1));
        // borrowing
        equalBN(borrowing, await borrowPool.borrowBalanceStored(borrower1));
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance1);
        equalBN("16000000000000000000", insurances.insurance0);
        // xole reserve
        equalBN("12000000000000000000", await borrowToken.balanceOf(xoleCtr.address));
        // pool returns
        equalBN("998012000000000000000000", await borrowPool.totalCash());
        equalBN("10000000000000000000000", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("16000000000000000000", await borrowingCtr.totalShares(borrowToken.address));
        // borrow more
        await borrowingCtr.borrow(market0Id, collateralIndex, 0, borrowing, {from: borrower1});
        collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(collateral, collateralOnChain);
        equalBN("3920000000000000000000", await borrowToken.balanceOf(borrower1));
        equalBN("0", await collateralToken.balanceOf(borrower1));
        equalBN("4000200000000000000000", await borrowPool.borrowBalanceStored(borrower1));
        insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance1);
        equalBN("32000000000000000000", insurances.insurance0);
        equalBN("24000000000000000000", await borrowToken.balanceOf(xoleCtr.address));
        equalBN("996024000000000000000000", await borrowPool.totalCash());
        equalBN("10000000000000000000000", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("32000000000000000000", await borrowingCtr.totalShares(borrowToken.address));
    })

    it("borrow token1 with two accounts successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowing = toWei(2000);

        let collateral2 = toWei(10000).add(toWei(1000));

        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await collateralToken.mint(borrower2, collateral2);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral2, borrowing.add(toWei(1000)), {from: borrower2});

        let collateralOnChain1 = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        let collateralOnChain2 = await borrowingCtr.activeBorrows(borrower2, market0Id, collateralIndex);
        equalBN(collateral, collateralOnChain1);
        equalBN(collateral2, collateralOnChain2);
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN(toWei(5000).mul(toBN(2)).div(toBN(100)).mul(toBN(4)).div(toBN(10)), insurances.insurance1);
        equalBN(insurances.insurance1, await borrowingCtr.totalShares(borrowToken.address));
        equalBN(collateral.mul(toBN(2)).add(toWei(1000)), await borrowingCtr.totalShares(collateralToken.address));
    })

    it("borrow 0 and collateral 0 were unsuccessful", async () => {
        let collateralIndex = true;
        await expectRevert(
            borrowingCtr.borrow(market0Id, collateralIndex, 0, 0, {from: borrower1}),
            'CB0'
        );
    })

    it("borrow lt 0.0001 was unsuccessful", async () => {
        let collateralIndex = true;
        await expectRevert(
            borrowingCtr.borrow(market0Id, collateralIndex, 0, toWei(1).div(toBN(10000)), {from: borrower1}),
            'BTS'
        );
    })

    it("borrow gt 10% dex liquidity was unsuccessful", async () => {
        let collateral = toWei(1000000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(initLiquidity).div(toBN(10)).add(toBN(1));
        await collateralToken.mint(borrower1, collateral);
        await expectRevert(
            borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1}),
            'BGL'
        );
    })

    it("borrow gt collateralRatio was unsuccessful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(5001);
        await collateralToken.mint(borrower1, collateral);
        await dexAggCtr.setPrice(1, 2, 2, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1}),
            'BNH'
        );
        await dexAggCtr.setPrice(2, 1, 2, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1}),
            'BNH'
        );
        await dexAggCtr.setPrice(1, 1, 1, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1}),
            'BNH'
        );
    })

    it("redeem token0 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.redeem(market0Id, collateralIndex, toWei(1000), {from: borrower1});
        equalBN(toWei(1000), await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(toWei(9000), collateralOnChain);
        equalBN(toWei(9000), await borrowingCtr.totalShares(collateralToken.address));
    })

    it("redeem token1 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.redeem(market0Id, collateralIndex, toWei(1000), {from: borrower1});
        equalBN(toWei(1000), await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(toWei(9000), collateralOnChain);
        equalBN(toWei(9000), await borrowingCtr.totalShares(collateralToken.address));

    })

    it("redeem token0 with two accounts successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(2000);

        let collateral2 = toWei(10000).add(toWei(1000));

        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await collateralToken.mint(borrower2, collateral2);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral2, borrowing.add(toWei(1000)), {from: borrower2});
        await borrowingCtr.redeem(market0Id, collateralIndex, toWei(1000), {from: borrower1});
        await borrowingCtr.redeem(market0Id, collateralIndex, toWei(2000), {from: borrower2});

        let collateralOnChain1 = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        let collateralOnChain2 = await borrowingCtr.activeBorrows(borrower2, market0Id, collateralIndex);
        equalBN(collateral.sub(toWei(1000)), collateralOnChain1);
        equalBN(collateral2.sub(toWei(2000)), collateralOnChain2);
        equalBN(collateral.mul(toBN(2)).add(toWei(1000)).sub(toWei(3000)), await borrowingCtr.totalShares(collateralToken.address));
        equalBN(toWei(1000), await collateralToken.balanceOf(borrower1));
        equalBN(toWei(2000), await collateralToken.balanceOf(borrower2));

    })

    it("redeem gt collateral unsuccessful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await expectRevert(
            borrowingCtr.redeem(market0Id, collateralIndex, toWei(10001), {from: borrower1}),
            "RGC")
    })

    it("redeem too much collateral unhealthy and unsuccessful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await expectRevert(
            borrowingCtr.redeem(market0Id, collateralIndex, toWei(6001), {from: borrower1}),
            "BNH")
    })

    it("repay token1 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.repay(market0Id, collateralIndex, toWei(1000), false, {from: borrower1});
        equalBN(toWei(960), await borrowToken.balanceOf(borrower1));
        equalBN("1000200000000000000000", await borrowPool.borrowBalanceStored(borrower1));
    })

    it("repay token0 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.repay(market0Id, collateralIndex, toWei(1000), false, {from: borrower1});
        equalBN(toWei(960), await borrowToken.balanceOf(borrower1));
        equalBN("1000200000000000000000", await borrowPool.borrowBalanceStored(borrower1));
    })

    it("repay and redeem token0 with two accounts successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowing = toWei(2000);

        let collateral2 = toWei(10000).add(toWei(1000));

        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await collateralToken.mint(borrower2, collateral2);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral2, borrowing.add(toWei(1000)), {from: borrower2});

        await borrowToken.mint(borrower1, toWei(1000));
        await borrowToken.mint(borrower2, toWei(2000));

        await borrowingCtr.repay(market0Id, collateralIndex, toWei(1000), true, {from: borrower1});
        await borrowingCtr.repay(market0Id, collateralIndex, toWei(2000), true, {from: borrower2});

        let collateralOnChain1 = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        let collateralOnChain2 = await borrowingCtr.activeBorrows(borrower2, market0Id, collateralIndex);
        equalBN("5003000000000000000000", collateralOnChain1);
        equalBN("3669600000000000000000", collateralOnChain2);
        equalBN("8672600000000000000000", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("4997000000000000000000", await collateralToken.balanceOf(borrower1));
        equalBN("7330400000000000000000", await collateralToken.balanceOf(borrower2));
    })

    it("repay and redeem token1 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.repay(market0Id, collateralIndex, toWei(1000), true, {from: borrower1});
        equalBN("4999000000000000000000", await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN("5001000000000000000000", collateralOnChain);
        equalBN("5001000000000000000000", await borrowingCtr.totalShares(collateralToken.address));
        equalBN(toWei(960), await borrowToken.balanceOf(borrower1));
        equalBN("1000200000000000000000", await borrowPool.borrowBalanceStored(borrower1));
    })

    it("repay and redeem token0 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.repay(market0Id, collateralIndex, toWei(1000), true, {from: borrower1});
        equalBN("4999000000000000000000", await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN("5001000000000000000000", collateralOnChain);
        equalBN("5001000000000000000000", await borrowingCtr.totalShares(collateralToken.address));
        equalBN(toWei(960), await borrowToken.balanceOf(borrower1));
        equalBN("1000200000000000000000", await borrowPool.borrowBalanceStored(borrower1));
    })

    it("repay all token0 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowToken.mint(borrower1, toWei(41));
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.repay(market0Id, collateralIndex, maxUint(), false, {from: borrower1});
        equalBN("800000000000000000", await borrowToken.balanceOf(borrower1));
        equalBN(collateral, await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN("0", collateralOnChain);
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("0", await borrowPool.borrowBalanceStored(borrower1));
    })

    it("repay all and redeem token0 successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowToken.mint(borrower1, toWei(41));
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.repay(market0Id, collateralIndex, maxUint(), true, {from: borrower1});
        equalBN("800000000000000000", await borrowToken.balanceOf(borrower1));
        equalBN(collateral, await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN("0", collateralOnChain);
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("0", await borrowPool.borrowBalanceStored(borrower1));
    })

    it("repay and borrows eq 0 unsuccessful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowToken.mint(borrower1, toWei(50));
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowToken.approve(borrowPool.address, toWei(2010), {from: borrower1});
        await borrowPool.repayBorrowBehalf(borrower1, toWei(2010), {from: borrower1});
        await expectRevert(
            borrowingCtr.repay(market0Id, collateralIndex, 0, false, {from: borrower1}),
            "BL0");
    })

    it("repay eq 0 unsuccessful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await expectRevert(
            borrowingCtr.repay(market0Id, collateralIndex, 0, false, {from: borrower1}),
            "RL0");
    })

    it("repay and redeem in unhealthy state unsuccessful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(5000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await dexAggCtr.setPrice(1, 2, 2, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.repay(market0Id, collateralIndex, toWei(1000), true, {from: borrower1}),
            "BNH"
        );
    })

    it("repay with collateral eq 0 unsuccessful", async () => {
        let collateralIndex = true;
        await expectRevert(
            borrowingCtr.repay(market0Id, collateralIndex, 0, false, {from: borrower1}),
            "CE0");
    })

    it("liquidate token0 and return 0 to borrower successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;
        let borrowing = toWei(5000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // check collateral ratio lt 10000
        equalBN("9999", await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1));
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, collateralOnChain);
        equalBN("0", await borrowPool.borrowBalanceStored(borrower1));
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance0);
        equalBN("55004500000000000000", insurances.insurance1);
        // pool returns
        equalBN("1000041503000000000000000", await borrowPool.totalCash());
        // liquidator returns
        equalBN("20006000000000000000", await borrowToken.balanceOf(liquidator));
        // total share
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("55004500000000000000", await borrowingCtr.totalShares(borrowToken.address));
        // buy back contract reserve
        equalBN("5001500000000000000", await borrowToken.balanceOf(buyBackCtr.address));
        // borrower balance
        equalBN("0", await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token1 and return 0 to borrower successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(5000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // check collateral ratio lt 10000
        equalBN("9999", await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1));
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, collateralOnChain);
        equalBN("0", await borrowPool.borrowBalanceStored(borrower1));
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance1);
        equalBN("55004500000000000000", insurances.insurance0);
        // pool returns
        equalBN("1000041503000000000000000", await borrowPool.totalCash());
        // liquidator returns
        equalBN("20006000000000000000", await borrowToken.balanceOf(liquidator));
        // total share
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("55004500000000000000", await borrowingCtr.totalShares(borrowToken.address));
        // buy back contract reserve
        equalBN("5001500000000000000", await borrowToken.balanceOf(buyBackCtr.address));
        // borrower balance
        equalBN("0", await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token0 and return few collateral successful", async () => {
        let collateral = toWei(3000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(1500);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        let sellAmount = collateral.sub(toWei(100));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(collateral.sub(sellAmount), await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token1 and return few collateral successful", async () => {
        let collateral = toWei(4000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        let sellAmount = collateral.sub(toWei(200));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(collateral.sub(sellAmount), await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token1 with two accounts successful", async () => {
        let collateral = toWei(4000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await collateralToken.mint(borrower2, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower2});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        let sellAmount = collateral.sub(toWei(200));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(collateral.sub(sellAmount), await collateralToken.balanceOf(borrower1));
        let collateralOnChain1 = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, collateralOnChain1);
        let collateralOnChain2 = await borrowingCtr.activeBorrows(borrower2, market0Id, collateralIndex);
        equalBN(collateral, collateralOnChain2);
        equalBN(collateralOnChain2, await borrowingCtr.totalShares(collateralToken.address));
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower2, {from: liquidator});
        collateralOnChain2 = await borrowingCtr.activeBorrows(borrower2, market0Id, collateralIndex);
        equalBN(0, collateralOnChain2);
        equalBN(0, await borrowingCtr.totalShares(collateralToken.address));
    })

    it("liquidate partial token0 and repay all successful", async () => {
        let collateral = toWei(3000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(1500);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        let sellAmount = collateral.sub(toWei(1500));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        await dexAggCtr.setLiquidity(collateral.div(toWei(10)), collateral.div(toWei(10)));
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(collateral.sub(sellAmount), await collateralToken.balanceOf(borrower1));
    })

    it("liquidate partial token0 and repay partial successful", async () => {
        let collateral = toWei(3000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowPool = pool1;
        let borrowing = toWei(1500);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await dexAggCtr.setBuySuccessful(false);
        let sellAmount = collateral.sub(toWei(1500));
        await dexAggCtr.setBuyAndSellAmount(borrowing.div(toWei(2)), sellAmount);
        await dexAggCtr.setLiquidity(collateral.div(toWei(10)), collateral.div(toWei(10)));
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(0, await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(collateral.sub(sellAmount),collateralOnChain);
        let borrows = await borrowPool.borrowBalanceCurrent(borrower1);
        equalBN("1500899999999999999257", borrows);
        equalBN(collateralOnChain, await borrowingCtr.totalShares(collateralToken.address));
    })

    it("liquidate token0 and and insurance reduce few successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;
        let borrowing = toWei(5000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await dexAggCtr.setBuySuccessful(false);
        let buyAmount = borrowing.add(toWei(40));
        await dexAggCtr.setBuyAndSellAmount(buyAmount, 0);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(0, await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, collateralOnChain);
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance0);
        equalBN("42220000000000000000", insurances.insurance1);
        // pool returns
        equalBN("1000042580000000000000000", await borrowPool.totalCash());
        // liquidator returns
        equalBN("20160000000000000000", await borrowToken.balanceOf(liquidator));
        // total share
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("42220000000000000000", await borrowingCtr.totalShares(borrowToken.address));
        // buy back contract reserve
        equalBN("5040000000000000000", await borrowToken.balanceOf(buyBackCtr.address));
        // borrower balance
        equalBN("0", await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token1 and and insurance reduce few successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(5000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await dexAggCtr.setBuySuccessful(false);
        let buyAmount = borrowing.add(toWei(40));
        await dexAggCtr.setBuyAndSellAmount(buyAmount, 0);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(0, await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0,collateralOnChain);
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance1);
        equalBN("42220000000000000000", insurances.insurance0);
        // pool returns
        equalBN("1000042580000000000000000", await borrowPool.totalCash());
        // liquidator returns
        equalBN("20160000000000000000", await borrowToken.balanceOf(liquidator));
        // total share
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("42220000000000000000", await borrowingCtr.totalShares(borrowToken.address));
        // buy back contract reserve
        equalBN("5040000000000000000", await borrowToken.balanceOf(buyBackCtr.address));
        // borrower balance
        equalBN("0", await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token0 and insurance reduce to 0 successful", async () => {
        let collateral = toWei(3000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;
        let borrowing = toWei(1500);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await dexAggCtr.setBuySuccessful(false);
        let buyAmount = borrowing.sub(toWei(100));
        await dexAggCtr.setBuyAndSellAmount(buyAmount, 0);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(0, await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, collateralOnChain);
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance0);
        equalBN("4200000000000000000", insurances.insurance1);
        // pool returns
        equalBN("999909800000000000000000", await borrowPool.totalCash());
        // liquidator returns
        equalBN("5600000000000000000", await borrowToken.balanceOf(liquidator));
        // total share
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("4200000000000000000", await borrowingCtr.totalShares(borrowToken.address));
        // buy back contract reserve
        equalBN("1400000000000000000", await borrowToken.balanceOf(buyBackCtr.address));
        // borrower balance
        equalBN("0", await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token1 and insurance reduce to 0 successful", async () => {
        let collateral = toWei(3000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowToken = token0;
        let borrowPool = pool0;
        let borrowing = toWei(1500);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        // advance block
        await timeMachine.advanceBlock();
        // liquidate
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await dexAggCtr.setBuySuccessful(false);
        let buyAmount = borrowing.sub(toWei(100));
        await dexAggCtr.setBuyAndSellAmount(buyAmount, 0);
        await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        // borrower balance
        equalBN(0, await collateralToken.balanceOf(borrower1));
        let collateralOnChain = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(0, collateralOnChain);
        // insurance
        let insurances = await borrowingCtr.insurances(market0Id);
        equalBN("0", insurances.insurance1);
        equalBN("4200000000000000000", insurances.insurance0);
        // pool returns
        equalBN("999909800000000000000000", await borrowPool.totalCash());
        // liquidator returns
        equalBN("5600000000000000000", await borrowToken.balanceOf(liquidator));
        // total share
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("4200000000000000000", await borrowingCtr.totalShares(borrowToken.address));
        // buy back contract reserve
        equalBN("1400000000000000000", await borrowToken.balanceOf(buyBackCtr.address));
        // borrower balance
        equalBN("0", await collateralToken.balanceOf(borrower1));
    })

    it("liquidate token0 in 'CE0' error case", async () => {
        let collateralIndex = false;
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "CE0")
    })

    it("liquidate token1 in 'CE0' error case", async () => {
        let collateralIndex = true;
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "CE0")
    })

    it("liquidate token0 in 'BIH' error case", async () => {
        let collateral = toWei(3000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(1200);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "BIH")
        await dexAggCtr.setPrice(0, 1, 1, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "BIH")
        await dexAggCtr.setPrice(1, 0, 1, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "BIH")
    })

    it("liquidate token1 in 'BIH' error case", async () => {
        let collateral = toWei(4000);
        let collateralIndex = true;
        let collateralToken = token1;
        let borrowing = toWei(1800);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "BIH")
        await dexAggCtr.setPrice(0, 2, 2, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "BIH")
        await dexAggCtr.setPrice(2, 0, 2, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "BIH")
    })

    it("liquidate token0 in 'MPT' error case", async () => {
        let collateral = toWei(1000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(2000);
        await collateralToken.mint(borrower1, collateral);
        await dexAggCtr.setPrice(4, 4, 4, 0, {from: adminAcc});
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await dexAggCtr.setPrice(3, 4, 4, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "MPT")
    })

    it("liquidate token0 in 'XNE' error case", async () => {
        let collateral = toWei(1000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(800);
        await collateralToken.mint(borrower1, collateral);
        await dexAggCtr.setPrice(2, 2, 2, 0, {from: adminAcc});
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await dexAggCtr.setPrice(1, 1, 1, 0, {from: adminAcc});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "XNE")
    })

    it("liquidate token0 in 'BLR' error case", async () => {
        let collateral = toWei(1000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(500);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await dexAggCtr.setBuyAndSellAmount(borrowing, 0);
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "BLR")
    })

    it("liquidate token0 in 'BE0' error case", async () => {
        let collateral = toWei(1000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowing = toWei(500);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await dexAggCtr.setLiquidity(collateral.div(toBN(10)), collateral.div(toBN(10)));
        await dexAggCtr.setBuySuccessful(false);
        await dexAggCtr.setBuyAndSellAmount(borrowing.add(toWei(10)), 0);
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator, gas: 8000000}),
            "BE0")
    })

    it("suspend successful", async () => {
        await controllerCtr.setSuspend(true, {from: adminAcc});
        await expectRevert(
            borrowingCtr.borrow(market0Id, true, 0, 0, {from: borrower1}),
            "Suspended borrowing")
        await expectRevert(
            borrowingCtr.repay(market0Id, true, 0, false, {from: borrower1}),
            "Suspended borrowing")
        await expectRevert(
            borrowingCtr.redeem(market0Id, true, 0, {from: borrower1}),
            "Suspended borrowing")
        await expectRevert(
            borrowingCtr.liquidate(market0Id, true, borrower1, {from: liquidator}),
            "Suspended borrowing")
    })

    it("migrate markets successful", async () => {
        let dexs = [1];
        await openLevCtr.setMarket(1, pool0.address, pool1.address, token0.address, token1.address, dexs);
        await borrowingCtr.migrateOpenLevMarkets(1, 1, {from: adminAcc});
        let market1 = await borrowingCtr.markets(1);
        assert.equal(pool0.address, market1.pool0);
        assert.equal(pool1.address, market1.pool1);
        assert.equal(token0.address, market1.token0);
        assert.equal(token1.address, market1.token1);
        assert.equal(1, market1.dex);
        let marketConf = await borrowingCtr.marketsConf(1);
        equalBN("5000", marketConf.collateralRatio);
        let twaLiquidity = await borrowingCtr.twaLiquidity(1);
        equalBN(toWei(initLiquidity), twaLiquidity.token0Liq);
        equalBN(toWei(initLiquidity), twaLiquidity.token1Liq);
        await expectRevert(
            borrowingCtr.migrateOpenLevMarkets(1, 1, {from: liquidator}),
            "caller must be admin")
    })

    it("set twaLiquidity successful", async () => {
        let liqToken0 = toWei(1000);
        let liqToken1 = toWei(2000);
        await borrowingCtr.setTwaLiquidity([0], [[liqToken0, liqToken1]], {from: adminAcc});
        let twaLiquidity = await borrowingCtr.twaLiquidity(0);
        equalBN(liqToken0, twaLiquidity.token0Liq);
        equalBN(liqToken1, twaLiquidity.token1Liq);
        await expectRevert(
            borrowingCtr.setTwaLiquidity([0], [[liqToken0, liqToken1]], {from: liquidator}),
            "caller must be admin or developer")
    })

    it("set marketDefConf successful", async () => {
        marketConf[0] = 6000;
        await borrowingCtr.setMarketDefConf(marketConf, {from: adminAcc});
        let marketDefConf = await borrowingCtr.marketDefConf();
        equalBN(marketConf[0], marketDefConf.collateralRatio);
        await expectRevert(
            borrowingCtr.setMarketDefConf(marketConf, {from: liquidator}),
            "caller must be admin")
    })

    it("set marketConf successful", async () => {
        await borrowingCtr.setMarketConf(1, marketConf, {from: adminAcc});
        let marketConf1 = await borrowingCtr.marketsConf(1);
        equalBN(marketConf[0], marketConf1.collateralRatio);
        await expectRevert(
            borrowingCtr.setMarketConf(1, marketConf, {from: liquidator}),
            "caller must be admin")
    })

    it("set liquidationConf successful", async () => {
        let conf = [100, 1, token0.address];
        await borrowingCtr.setLiquidationConf(conf, {from: adminAcc});
        let liqConf = await borrowingCtr.liquidationConf();
        equalBN(conf[0], liqConf[0]);
        equalBN(conf[1], liqConf[1]);
        equalBN(conf[2], conf[2]);
        await expectRevert(
            borrowingCtr.setLiquidationConf(conf, {from: liquidator}),
            "caller must be admin")
    })

    it("move insurance successful", async () => {
        let collateral = toWei(1000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowing = toWei(100);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        let insurance1 = toBN((await borrowingCtr.insurances(market0Id)).insurance1);
        let moveInsurance = insurance1.div(toBN(4));
        await borrowingCtr.moveInsurance(market0Id, true, liquidator, moveInsurance, {from: adminAcc});
        let insuranceAfter = toBN((await borrowingCtr.insurances(market0Id)).insurance1);
        equalBN(insurance1.sub(moveInsurance), insuranceAfter);
        equalBN(insuranceAfter, await borrowingCtr.totalShares(borrowToken.address));
        equalBN(moveInsurance, await borrowToken.balanceOf(liquidator));
        // move gt insurance
        await expectRevert.unspecified(
            borrowingCtr.moveInsurance(market0Id, true, liquidator, insurance1, {from: adminAcc, gas: 800000}))

        await expectRevert.unspecified(
            borrowingCtr.moveInsurance(market0Id, false, liquidator, insurance1, {from: adminAcc, gas: 800000}))

        await expectRevert(
            borrowingCtr.moveInsurance(market0Id, true, liquidator, insurance1, {from: liquidator, gas: 800000}),
            "caller must be admin")
    })

});