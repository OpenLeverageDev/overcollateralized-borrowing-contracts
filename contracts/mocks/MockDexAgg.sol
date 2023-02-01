// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import "../interfaces/DexAggregatorInterface.sol";
import "./MockToken.sol";
import "../libraries/Utils.sol";
import "../libraries/DexData.sol";

pragma experimental ABIEncoderV2;

contract MockDexAgg is DexAggregatorInterface {
    using DexData for bytes;

    uint8 private constant _decimals = 24;
    uint256 private _price;
    uint256 private _cAvgPrice;
    uint256 private _hAvgPrice;
    uint256 private _timestamp;
    uint256 private _timeWindow;
    uint token0Liq;
    uint token1Liq;

    bool buySuccessful = true;

    uint buyAmount;
    uint sellAmount;

    function setPrice(uint256 price_, uint256 cAvgPrice_, uint256 hAvgPrice_, uint256 timestamp_) external {
        _price = price_ * (10 ** 24);
        _cAvgPrice = cAvgPrice_ * (10 ** 24);
        _hAvgPrice = hAvgPrice_ * (10 ** 24);
        _timestamp = timestamp_;
    }

    function getPrice(address desToken, address quoteToken, bytes memory data) external view override returns (uint256 price, uint8 decimals) {
        desToken;
        quoteToken;
        data;
        price = _price;
        decimals = _decimals;
    }

    function getPriceCAvgPriceHAvgPrice(
        address desToken,
        address quoteToken,
        uint32 secondsAgo,
        bytes memory dexData
    ) external view override returns (uint256 price, uint256 cAvgPrice, uint256 hAvgPrice, uint8 decimals, uint256 timestamp) {
        desToken;
        quoteToken;
        secondsAgo;
        dexData;
        price = _price;
        cAvgPrice = _cAvgPrice;
        hAvgPrice = _hAvgPrice;
        decimals = _decimals;
        timestamp = _timestamp;
    }

    function updatePriceOracle(address desToken, address quoteToken, uint32 timeWindow, bytes memory data) external override returns (bool) {
        desToken;
        quoteToken;
        _timeWindow = timeWindow;
        require(data.isUniV2Class(), "DER");
        return true;
    }

    function setLiquidity(uint _token0Liq, uint _token1Liq) external {
        token0Liq = _token0Liq;
        token1Liq = _token1Liq;
    }

    function getToken0Liquidity(address token0, address token1, bytes memory dexData) external view returns (uint) {
        token0;
        token1;
        dexData;
        return token0Liq;
    }

    function getPairLiquidity(address token0, address token1, bytes memory dexData) external view override returns (uint, uint) {
        token0;
        token1;
        dexData;
        return (token0Liq, token1Liq);
    }

    function setBuyAndSellAmount(uint _buyAmount, uint _sellAmount) external {
        buyAmount = _buyAmount;
        sellAmount = _sellAmount;
    }

    function setBuySuccessful(bool _buySuccessful) external {
        buySuccessful = _buySuccessful;
    }

    function buy(
        address buyToken,
        address sellToken,
        uint24 buyTax,
        uint24 sellTax,
        uint _buyAmount,
        uint _maxSellAmount,
        bytes memory data
    ) external override returns (uint) {
        buyTax;
        sellTax;
        data;
        assert(buySuccessful);
        uint mockBuyAmount = buyAmount == 0 ? _buyAmount : buyAmount;
        uint mockSellAmount = sellAmount == 0 ? _maxSellAmount : sellAmount;
        MockToken(buyToken).mint(address(this), Utils.toAmountBeforeTax(mockBuyAmount, buyTax));
        MockToken(buyToken).transfer(msg.sender, Utils.toAmountBeforeTax(mockBuyAmount, buyTax));
        MockToken(sellToken).transferFrom(msg.sender, address(this), Utils.toAmountBeforeTax(mockSellAmount, sellTax));
        return mockSellAmount;
    }

    function sell(address buyToken, address sellToken, uint _sellAmount, uint minBuyAmount, bytes memory data) external override returns (uint) {
        data;
        uint mockBuyAmount = buyAmount == 0 ? minBuyAmount : buyAmount;
        MockToken(buyToken).mint(address(this), mockBuyAmount);
        MockToken(buyToken).transfer(msg.sender, mockBuyAmount);
        MockToken(sellToken).transferFrom(msg.sender, address(this), _sellAmount);
        return mockBuyAmount;
    }
}
