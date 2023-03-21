const m = require('mocha-logger');
const MockToken = artifacts.require("MockToken");
const MockWETH = artifacts.require("MockWETH");
const {expectRevert} = require("@openzeppelin/test-helpers");
const Mock1inchRouter = artifacts.require("Mock1inchRouter");
const OPBuyBack = artifacts.require("OPBuyBack");
const OPBuyBackDelegator = artifacts.require("OPBuyBackDelegator");
const {toWei} = require("./util/Utils");

contract("OPBuyBack Test", async accounts => {
    let admin = accounts[0];
    let dev = accounts[1];
    let withdrawAddress =  "0xe9e7cea3dedca5984780bafc599bd69add087d56";
    let sellToken;
    let ole;
    let router;
    let wEth;
    let eth = "0x0000000000000000000000000000000000000000";
    let opBuyBack;
    let sellAmount = toWei(2);
    let swapCallData = "0x00000000000000000000000000000000000000000000000000015e00013051264ec3432d9443f05022e2ff4e54fc7514be2359e055d398326f99059ff775485246999027b3197955000438" +
        "ed173900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002934866f42048f2b0000000000000000000" +
        "0000000000000000000000000000000000000000000a000000000000000000000000018101ac1d35230f1a3c005e2abaaeb25cae79e7f00000000000000000000000000000000000000000000" +
        "000000000000638dfd34000000000000000000000000000000000000000000000000000000000000000200000000000000000000000055d398326f99059ff775485246999027b319795500000" +
        "0000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5680a06c4eca27e9e7cea3dedca5984780bafc599bd69add087d561111111254eeb25477b68fb85ed929f73a960582";

    beforeEach(async () => {
        sellToken = await MockToken.new('OLE');
        ole = await MockToken.new('TKA');
        router = await Mock1inchRouter.new(dev);
        wEth = await MockWETH.new();
        await sellToken.approve(router.address, toWei(10000000000), {from: dev});
        await ole.approve(router.address, toWei(10000000000), {from: dev});
        let delegatee = await OPBuyBack.new();
        opBuyBack = await OPBuyBackDelegator.new(ole.address, wEth.address, router.address, admin, delegatee.address);
        opBuyBack = await OPBuyBack.at(opBuyBack.address);
        await sellToken.mint(opBuyBack.address, toWei(10000000000).toString());
    });

    it("TransferIn and withdraw eth", async () => {
        assert.equal(await web3.eth.getBalance(opBuyBack.address), 0);
        await opBuyBack.transferIn(eth, toWei(1).toString(), {from: dev, value : toWei(1).toString()});
        assert.equal(await web3.eth.getBalance(opBuyBack.address), toWei(1).toString());

        let beforeEth =  await web3.eth.getBalance(withdrawAddress);
        await opBuyBack.withdraw(eth, withdrawAddress, toWei(1).toString());
        let afterEth =  await web3.eth.getBalance(withdrawAddress);
        assert.equal(afterEth - beforeEth, toWei(1).toString());
        assert.equal(await web3.eth.getBalance(opBuyBack.address), 0);
    })

    it("TransferIn and withdraw ERC20", async () => {
        assert.equal((await sellToken.balanceOf(opBuyBack.address)).toString(), toWei(10000000000).toString());
        await sellToken.approve(opBuyBack.address, toWei(1));
        await opBuyBack.transferIn(sellToken.address, toWei(1).toString());
        assert.equal(await sellToken.balanceOf(opBuyBack.address), toWei(10000000001).toString());

        assert.equal(await sellToken.balanceOf(withdrawAddress), 0);
        await opBuyBack.withdraw(sellToken.address, withdrawAddress, toWei(1).toString());
        assert.equal(await sellToken.balanceOf(withdrawAddress), toWei(1).toString());
    })

    it("Withdraw eth not enough", async () => {
        assert.equal(await web3.eth.getBalance(opBuyBack.address), 0);
        await expectRevert(
            opBuyBack.withdraw(eth, withdrawAddress, toWei(1).toString()),
            'revert'
        );
    })

    it("Withdraw ERC20 not enough", async () => {
        assert.equal((await ole.balanceOf(opBuyBack.address)).toString(), "0");
        await expectRevert(
            opBuyBack.withdraw(ole.address, withdrawAddress, toWei(1).toString()),
            'TF'
        );
    })

    it("Only admin can withdraw", async () => {
        await ole.mint(opBuyBack.address, toWei(1).toString());
        await expectRevert(
            opBuyBack.withdraw(ole.address, dev, toWei(1).toString(), {from : dev}),
            'caller must be admin'
        );
        assert.equal(await ole.balanceOf(dev), 0);
        await opBuyBack.withdraw(ole.address, dev, toWei(1).toString(), {from : admin});
        assert.equal(await ole.balanceOf(dev), toWei(1).toString());
        console.log("admin withdraw success.");
    })

    it("1inch router address only can modify by admin", async () => {
        await opBuyBack.setRouter1inch(eth, {from : admin});
        assert.equal(await opBuyBack.router1inch(), eth);
        console.log("1inch router update success by admin.");
        await expectRevert(
            opBuyBack.setRouter1inch(router.address, {from: dev}),
            'caller must be admin'
        );
    })

    it("Only admin or dev can buyBack", async () => {
        await sellToken.approve(opBuyBack.address, toWei(6));
        await opBuyBack.transferIn(sellToken.address, toWei(6).toString());
        let callData = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
            opBuyBack.address, sellAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();

        await ole.mint(dev, sellAmount.toString());
        await opBuyBack.buyBack(sellToken.address, sellAmount.toString() , "1999999999999999999", callData, {from: admin});
        console.log("buyBack success by admin.");

        await expectRevert(
            opBuyBack.buyBack(sellToken.address, sellAmount.toString() , "1999999999999999999", callData, {from: accounts[2]}),
            'Only admin or dev'
        );
    })

    it("Buyback src token must not is ole ", async () => {
        let callData = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
            opBuyBack.address, sellAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        await expectRevert(
            opBuyBack.buyBack(ole.address, "2000000000000000000" , "1999999999999999999", callData),
            'Token err'
        );
    })

    it("Buyback src token is eth ", async () => {
        let callData = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [wEth.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
            opBuyBack.address, sellAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        await opBuyBack.transferIn(eth, sellAmount.toString(), {from: dev, value : sellAmount.toString()});
        assert.equal(await web3.eth.getBalance(opBuyBack.address), sellAmount.toString());
        assert.equal(await wEth.balanceOf(opBuyBack.address), 0);
        assert.equal(await ole.balanceOf(opBuyBack.address), 0);
        await ole.mint(dev, sellAmount.toString());

        await opBuyBack.buyBack(eth, sellAmount.toString(), toWei(1).toString(), callData);
        assert.equal(await web3.eth.getBalance(opBuyBack.address), 0);
        assert.equal(await wEth.balanceOf(opBuyBack.address), 0);
        assert.equal(await ole.balanceOf(opBuyBack.address), "1999999999999999999");
    })

    it("1inch router by function : swap", async () => {
        assert.equal(await ole.balanceOf(opBuyBack.address), 0);
        await ole.mint(dev, sellAmount.toString());
        assert.equal(await ole.balanceOf(dev), "2000000000000000000");
        let callData = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
            opBuyBack.address, sellAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        await opBuyBack.buyBack(sellToken.address, "2000000000000000000" , "1999999999999999999", callData);
        assert.equal(await ole.balanceOf(opBuyBack.address), "1999999999999999999");
        assert.equal(await ole.balanceOf(dev), "0");
    })

    it("1inch router by function : unoswap", async () => {
        assert.equal(await ole.balanceOf(opBuyBack.address), 0);
        await ole.mint(dev, sellAmount.toString());
        let callData = router.contract.methods.unoswap(sellToken.address, sellAmount.toString(), "1999999999999999999", ["1457117133357877736574669614693451329632719413002162662161"]).encodeABI();

        m.log("set verify info, start ---");
        await router.setVerifyAmount(sellAmount.toString());
        await router.setVerifyMinReturn("1999999999999999999");
        await router.setVerifyPools(["1457117133357877736574669614693451329632719413002162662161"]);
        await router.setVerifySrcToken(sellToken.address);
        await router.setVerifyDstToken(ole.address);
        m.log("set verify info, finished ---");

        await opBuyBack.buyBack(sellToken.address, sellAmount.toString(), sellAmount.toString(), callData);
        assert.equal(await ole.balanceOf(opBuyBack.address), sellAmount.toString());
    })

    it("1inch router by function : uniswapV3Swap", async () => {
        assert.equal(await ole.balanceOf(opBuyBack.address), 0);
        await ole.mint(dev, sellAmount.toString());
        let callData = router.contract.methods.uniswapV3Swap(sellAmount.toString(), "1999999999999999999", ["1457117133357877736574669614693451329632719413002162662161"]).encodeABI();

        m.log("set verify info, start ---");
        await router.setVerifyAmount(sellAmount.toString());
        await router.setVerifyMinReturn("1999999999999999999");
        await router.setVerifyPools(["1457117133357877736574669614693451329632719413002162662161"]);
        await router.setVerifySrcToken(sellToken.address);
        await router.setVerifyDstToken(ole.address);
        m.log("set verify info, finished ---");

        await opBuyBack.buyBack(sellToken.address, sellAmount.toString(), sellAmount.toString(), callData);
        assert.equal(await ole.balanceOf(opBuyBack.address), sellAmount.toString());
    })

    it("1inch router by not supported function, revert", async () => {
        let callData = router.contract.methods.clipperSwap(sellAmount.toString(), "1999999999999999999", ["1457117133357877736574669614693451329632719413002162662161"]).encodeABI();
        await expectRevert(
            opBuyBack.buyBack(sellToken.address, sellAmount.toString(), sellAmount.toString(), callData),
            'USF'
        );
    })

    it("Verify call 1inch data, receive buyToken address is not buybackContract, revert", async () => {
        let callData = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
                dev, sellAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        await ole.mint(dev, sellAmount.toString());
        await expectRevert(
            opBuyBack.buyBack(sellToken.address, sellAmount.toString(), sellAmount.toString(), callData),
            '1inch: buy amount less than min'
        );
    })

    it("Verify call 1inch data, sellToken address is another token, revert", async () => {
        let callData = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [ole.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
                opBuyBack.address, sellAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        await expectRevert(
            opBuyBack.buyBack(sellToken.address, sellAmount.toString(), sellAmount.toString(), callData),
            'sell token error'
        );
    })

    it("Verify call 1inch data, buyToken address is another token, revert", async () => {
        let callData = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, sellToken.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
                opBuyBack.address, sellAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        await ole.mint(dev, sellAmount.toString());
        await sellToken.mint(dev, sellAmount.toString());
        await expectRevert(
            opBuyBack.buyBack(sellToken.address, sellAmount.toString(), sellAmount.toString(), callData),
            '1inch: buy amount less than min'
        );
    })

    it("Test replace call 1inch data", async () => {
        let moreThanAmount = toWei(4);
        let callData = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
                opBuyBack.address, moreThanAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        m.log("set incoming sell amount more than actual sell amount");
        assert.equal(await ole.balanceOf(opBuyBack.address), 0);
        await ole.mint(dev, sellAmount.toString());
        await opBuyBack.buyBack(sellToken.address, "2000000000000000000" , "1999999999999999999", callData);
        assert.equal(await ole.balanceOf(opBuyBack.address), "1999999999999999999");

        let lessThanAmount = toWei(1);
        let callData2 = router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
                opBuyBack.address, lessThanAmount.toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        m.log("set incoming sell amount less than actual sell amount");
        await ole.mint(dev, sellAmount.toString());
        await opBuyBack.buyBack(sellToken.address, "2000000000000000000" , "1999999999999999999", callData2);
        assert.equal((await ole.balanceOf(opBuyBack.address)).toString(), "3999999999999999999");
    })

    it("Sell by 1inch data, if 1inch revert, then revert with error info", async () => {
        let callData =  router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
            opBuyBack.address, toWei(2).toString(), toWei(1).toString(), 4], "0x", swapCallData).encodeABI();
        await ole.mint(dev, "999999999999999999");
        await expectRevert(
            opBuyBack.buyBack(sellToken.address, sellAmount.toString(), "1999999999999999999", callData),
            'ReturnAmountIsNotEnough2'
        );
    })

    it("Sell by 1inch data, buyAmount less than minBuyAmount, revert", async () => {
        let callData =  router.contract.methods.swap("0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f", [sellToken.address, ole.address, "0x18101Ac1d35230F1A3c005e2aBaAEb25caE79e7f",
            opBuyBack.address, toWei(2).toString(), "999999999999999999", 4], "0x", swapCallData).encodeABI();
        await ole.mint(dev, toWei(1).toString());
        await expectRevert(
            opBuyBack.buyBack(sellToken.address, sellAmount.toString(), "1999999999999999999", callData),
            '1inch: buy amount less than min'
        );
    })

})