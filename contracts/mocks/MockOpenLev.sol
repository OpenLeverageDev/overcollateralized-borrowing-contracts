// SPDX-License-Identifier: BUSL-1.1

pragma solidity >0.7.6;

import "../interfaces/OpenLevInterface.sol";

contract MockOpenLev is OpenLevInterface {
    Market public market;
    uint32[] public dexs;
    mapping(address => mapping(uint => uint24)) private _taxes;

    function setMarket(address pool0, address pool1, address token0, address token1, uint32[] memory _dexs) external {
        market.pool0 = pool0;
        market.pool1 = pool1;
        market.token0 = token0;
        market.token1 = token1;
        dexs = _dexs;
    }

    function markets(uint16 marketId) external view override returns (Market memory){
        marketId;
        return market;
    }

    function setTaxRate(address token, uint index, uint24 tax) external {
        _taxes[token][index] = tax;
    }

    function taxes(uint16 marketId, address token, uint index) external view override returns (uint24){
        marketId;
        return _taxes[token][index];
    }

    function getMarketSupportDexs(uint16 marketId) external view override returns (uint32[] memory){
        marketId;
        return dexs;
    }
}
