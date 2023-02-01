// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockReentrancyToken is ERC20 {
    bool public isReentrancy;

    constructor(string memory name_) ERC20(name_, name_) {
        mint(msg.sender, 10000000 ether);
    }

    function setReentrancy(bool _isReentrancy) public payable {
        isReentrancy = _isReentrancy;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (isReentrancy) {
            (bool success, ) = from.call{ value: 1 wei }("");
            assembly {
                let free_mem_ptr := mload(0x40)
                returndatacopy(free_mem_ptr, 0, returndatasize())
                switch success
                case 0 {
                    revert(free_mem_ptr, returndatasize())
                }
                default {
                    return(free_mem_ptr, returndatasize())
                }
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    receive() external payable {}
}
