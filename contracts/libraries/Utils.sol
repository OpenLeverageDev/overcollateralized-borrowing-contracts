// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.0 <0.9.0;

library Utils {
    uint constant feeRatePrecision = 10 ** 6;

    function toAmountBeforeTax(
        uint256 amount,
        uint24 feeRate
    ) internal pure returns (uint) {
        uint denominator = feeRatePrecision - feeRate;
        uint numerator = amount * feeRatePrecision + denominator - 1;
        return numerator / denominator;
    }

    function toAmountAfterTax(
        uint256 amount,
        uint24 feeRate
    ) internal pure returns (uint) {
        return (amount * (feeRatePrecision - feeRate)) / feeRatePrecision;
    }

    function minOf(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }

    function maxOf(uint a, uint b) internal pure returns (uint) {
        return a > b ? a : b;
    }
}
