const OPBorrowing = artifacts.require("OPBorrowing");
const OPBorrowingDelegator = artifacts.require("OPBorrowingDelegator");
const MockBuyBack = artifacts.require("MockBuyBack");
const MockController = artifacts.require("MockController");
const MockDexAgg = artifacts.require("MockDexAgg");
const MockLPool = artifacts.require("MockLPool");
const MockOpenLev = artifacts.require("MockOpenLev");
const MockWETH = artifacts.require("MockWETH");
const MockTaxToken = artifacts.require("MockTaxToken");

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
        token0 = await MockTaxToken.new("Token0", {from: adminAcc});
        token1 = await MockTaxToken.new("Token1", {from: adminAcc});
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

        await token0.setDexAgg(dexAggCtr.address);
        await token1.setDexAgg(dexAggCtr.address);
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});

    });

    it("borrow tax token successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;
        let borrowing = toWei(5000);
        await collateralToken.mint(borrower1, collateral);
        let transFees = 2;
        await borrowToken.setFees(transFees, 0, 0);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN(collateral, activeBorrows.collateral);
        let collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("10000", collateralRatio);
        equalBN(borrowing, await borrowPool.borrowBalanceCurrent(borrower1));
        equalBN(percent(percent(borrowing, 100 - transFees).sub(percent(borrowing, 2)), 100 - transFees), await borrowToken.balanceOf(borrower1));
    })

    it("liquidate tax token successful", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowPool = pool1;
        let borrowing = toWei(5000);
        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});

        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        // active borrows
        equalBN(collateral, activeBorrows.collateral);
        let collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("10000", collateralRatio);
        // set tax
        let transFees = 2;
        let buyFees = 1;
        let sellFees = 4;
        await borrowToken.setFees(transFees, 0, buyFees);
        await openLevCtr.setTaxRate(borrowToken.address, 0, transFees);
        await openLevCtr.setTaxRate(borrowToken.address, 2, buyFees);
        await collateralToken.setFees(0, sellFees, 0);
        await openLevCtr.setTaxRate(collateralToken.address, 1, sellFees);
        //  liquidate
        let insuranceBefore = (await borrowingCtr.insurances(market0Id)).insurance1;
        let sellAmount = collateral.div(toBN(2));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        let tx = await borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator});
        let liqEvent = tx.receipt.logs[0];
        m.log("liquidateFees", liqEvent.args.liquidateFees.toString());
        equalBN("50035000000000000001", liqEvent.args.liquidateFees);
        activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        equalBN("0", activeBorrows.collateral);
        equalBN("0", await borrowingCtr.totalShares(collateralToken.address));
        equalBN("0", await borrowPool.borrowBalanceCurrent(borrower1));
        equalBN(collateral.sub(sellAmount.add(toBN(1)).mul(toBN(100)).div(toBN(96))), await collateralToken.balanceOf(borrower1));
        equalBN(toBN(19), toETH(await borrowToken.balanceOf(liquidator)));
        equalBN(toBN(4), toETH(await borrowToken.balanceOf(buyBackCtr.address)));
        equalBN(toBN(15), toETH((await borrowingCtr.insurances(market0Id)).insurance1.sub(insuranceBefore)));
        equalBN(await borrowToken.balanceOf(borrowingCtr.address), await borrowingCtr.totalShares(borrowToken.address));
        equalBN((await borrowingCtr.insurances(market0Id)).insurance1, await borrowingCtr.totalShares(borrowToken.address));
    })

    it("liquidate tax token in 'BLR' error case", async () => {
        let collateral = toWei(10000);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowing = toWei(5000);

        await collateralToken.mint(borrower1, collateral);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});

        let activeBorrows = await borrowingCtr.activeBorrows(borrower1, market0Id, collateralIndex);
        // active borrows
        equalBN(collateral, activeBorrows.collateral);
        let collateralRatio = await borrowingCtr.collateralRatio(market0Id, collateralIndex, borrower1);
        equalBN("10000", collateralRatio);
        // set tax
        let transFees = 2;
        let buyFees = 1;
        let sellFees = 4;
        await borrowToken.setFees(transFees, 0, buyFees);
        await collateralToken.setFees(0, sellFees, 0);
        //  liquidate
        let sellAmount = collateral.div(toBN(2));
        await dexAggCtr.setBuyAndSellAmount(0, sellAmount);
        await xoleCtr.mint(toWei(liquidatorXOLEHeld), {from: liquidator});
        await expectRevert(
            borrowingCtr.liquidate(market0Id, collateralIndex, borrower1, {from: liquidator}),
            "BLR")
    })

    it("move deflationary token insurance successful", async () => {
        let collateral = toWei(100);
        let collateralIndex = false;
        let collateralToken = token0;
        let borrowToken = token1;
        let borrowing = toWei(10);
        await collateralToken.mint(borrower1, collateral);
        let fees = 1;
        await borrowToken.setFees(fees, 0, 0);
        await borrowingCtr.borrow(market0Id, collateralIndex, collateral, borrowing, {from: borrower1});
        let insurance1 = toBN((await borrowingCtr.insurances(market0Id)).insurance1);
        let moveInsurance = insurance1.div(toBN(4));
        await borrowingCtr.moveInsurance(market0Id, true, liquidator, moveInsurance, {from: adminAcc});
        let moveBalance = await borrowToken.balanceOf(liquidator);
        let insuranceAfter = toBN((await borrowingCtr.insurances(market0Id)).insurance1);
        equalBN(insurance1.sub(moveInsurance), insuranceAfter);
        equalBN(insuranceAfter, await borrowingCtr.totalShares(borrowToken.address));
        equalBN(percent(moveInsurance, 100 - fees), moveBalance);

    })

});