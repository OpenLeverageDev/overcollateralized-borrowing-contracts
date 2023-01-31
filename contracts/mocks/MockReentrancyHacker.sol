// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../IOPBorrowing.sol";

contract MockReentrancyHacker {
    uint public flag;

    IOPBorrowing public opBorrowing;

    function setFlag(uint _flag) external {
        flag = _flag;
    }

    function setOpBorrowing(IOPBorrowing _opBorrowing) external {
        opBorrowing = _opBorrowing;
    }


    function borrow(uint16 marketId, bool collateralIndex, uint collateral, uint borrowing) public {
        opBorrowing.borrow(marketId, collateralIndex, collateral, borrowing);
    }

    function repay(uint16 marketId, bool collateralIndex, uint repayAmount, bool isRedeem) public {
        opBorrowing.repay(marketId, collateralIndex, repayAmount, isRedeem);
    }

    function redeem(uint16 marketId, bool collateralIndex, uint collateral) public {
        opBorrowing.redeem(marketId, collateralIndex, collateral);
    }

    function liquidate(uint16 marketId, bool collateralIndex, address borrower) public {
        opBorrowing.liquidate(marketId, collateralIndex, borrower);
    }

    receive() external payable {
        if (flag == 1) {
            borrow(0, true, 0, 0);
        } else if (flag == 2) {
            repay(0, true, 0, true);
        } else if (flag == 3) {
            redeem(0, true, 0);
        } else if (flag == 4) {
            liquidate(0, true, msg.sender);
        }
    }
}
