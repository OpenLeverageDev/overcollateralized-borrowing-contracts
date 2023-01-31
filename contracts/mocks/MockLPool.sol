// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.17;

import "../interfaces/LPoolInterface.sol";
import "./MockToken.sol";

contract MockLPool is LPoolInterface {
    uint constant RATE_DENOMINATOR = 10000;
    address public immutable override underlying;
    uint public override totalBorrows;
    uint public borrowRateOfPerBlock;
    uint borrowIndex = 1e18;
    uint accrualBlockNumber;
    mapping(address => BorrowSnapshot) internal accountBorrows;

    struct BorrowSnapshot {
        uint principal;
        uint borrowIndex;
    }

    constructor(address _underlying, uint _borrowRateOfPerBlock) {
        underlying = _underlying;
        borrowRateOfPerBlock = _borrowRateOfPerBlock;
    }

    function mint(uint amount) external payable {
        MockToken(underlying).transferFrom(msg.sender, address(this), amount);
    }

    function totalCash() external view returns (uint) {
        return MockToken(underlying).balanceOf(address(this));
    }

    function borrowBalanceCurrent(address account) external view override returns (uint) {
        return borrowBalanceCurrentInternal(account);
    }

    function borrowBalanceStored(address account) external view override returns (uint) {
        return accountBorrows[account].principal;
    }

    function borrowBehalf(address borrower, uint borrowAmount) external override {
        accrueInterest();
        uint accBorrows = borrowBalanceCurrentInternal(borrower);
        accountBorrows[borrower].principal = accBorrows + borrowAmount;
        accountBorrows[borrower].borrowIndex = borrowIndex;
        totalBorrows = totalBorrows + borrowAmount;
        MockToken(underlying).transfer(msg.sender, borrowAmount);
    }

    function repayBorrowBehalf(address borrower, uint repayAmount) external override {
        accrueInterest();
        uint accBorrows = borrowBalanceCurrentInternal(borrower);
        uint balancePrior = MockToken(underlying).balanceOf(address(this));
        MockToken(underlying).transferFrom(msg.sender, address(this), repayAmount);
        repayAmount = MockToken(underlying).balanceOf(address(this)) - balancePrior;
        if (repayAmount > accBorrows) {
            require((repayAmount * (1e18)) / (accBorrows) <= 105e16, "repay more than 5%");
        }
        uint decreaseBorrows = accBorrows > repayAmount ? repayAmount : accBorrows;
        accountBorrows[borrower].principal = accBorrows - decreaseBorrows;
        accountBorrows[borrower].borrowIndex = borrowIndex;
        totalBorrows = totalBorrows - decreaseBorrows;
    }

    function repayBorrowEndByOpenLev(address borrower, uint repayAmount) external override {
        accrueInterest();
        MockToken(underlying).transferFrom(msg.sender, address(this), repayAmount);
        uint accBorrows = borrowBalanceCurrentInternal(borrower);
        accountBorrows[borrower].principal = 0;
        accountBorrows[borrower].borrowIndex = borrowIndex;
        totalBorrows -= accBorrows;
    }

    function accrueInterest() internal {
        uint currentBlockNumber = block.number;
        uint accrualBlockNumberPrior = accrualBlockNumber;
        if (accrualBlockNumberPrior == currentBlockNumber) {
            return;
        }

        uint borrowsPrior = totalBorrows;
        uint borrowIndexPrior = borrowIndex;

        uint blockDelta = currentBlockNumber - accrualBlockNumberPrior;

        uint simpleInterestFactor = borrowRateOfPerBlock * blockDelta;
        uint interestAccumulated = (simpleInterestFactor * borrowsPrior) / RATE_DENOMINATOR;
        uint totalBorrowsNew = borrowsPrior + interestAccumulated;
        uint borrowIndexNew = borrowIndexPrior + (borrowIndexPrior * simpleInterestFactor) / RATE_DENOMINATOR;

        accrualBlockNumber = currentBlockNumber;
        borrowIndex = borrowIndexNew;
        totalBorrows = totalBorrowsNew;
    }

    function borrowBalanceCurrentInternal(address account) internal view returns (uint) {
        if (accountBorrows[account].principal == 0) {
            return 0;
        }
        uint cBorrowIndex = calBorrowIndex();
        return (accountBorrows[account].principal * cBorrowIndex) / accountBorrows[account].borrowIndex;
    }

    function calBorrowIndex() internal view returns (uint) {
        return
            borrowIndex + (borrowIndex * (block.number - accrualBlockNumber) * borrowRateOfPerBlock) / RATE_DENOMINATOR;
    }
}
