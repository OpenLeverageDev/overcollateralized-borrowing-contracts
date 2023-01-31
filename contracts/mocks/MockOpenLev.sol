// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.17;

import "../interfaces/OpenLevInterface.sol";

contract MockOpenLev is OpenLevInterface {
    mapping(address => mapping(uint => uint24)) private _taxes;
    mapping(uint16 => Market) private _markets;
    mapping(uint16 => uint32[]) private dexs;

    function setMarket(uint16 marketId, address pool0, address pool1, address token0, address token1, uint32[] memory _dexs) external {
        Market memory market;
        market.pool0 = pool0;
        market.pool1 = pool1;
        market.token0 = token0;
        market.token1 = token1;
        dexs[marketId] = _dexs;
        _markets[marketId] = market;
    }

    function markets(uint16 marketId) external view override returns (Market memory) {
        return _markets[marketId];
    }

    function setTaxRate(address token, uint index, uint24 tax) external {
        _taxes[token][index] = tax * 10000;
    }

    function taxes(uint16 marketId, address token, uint index) external view override returns (uint24) {
        marketId;
        return _taxes[token][index];
    }

    function getMarketSupportDexs(uint16 marketId) external view override returns (uint32[] memory) {
        return dexs[marketId];
    }
}
