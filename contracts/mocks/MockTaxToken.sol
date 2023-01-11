// SPDX-License-Identifier: BUSL-1.1
pragma solidity >0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockTaxToken is ERC20 {
    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;

    address public dexAgg;
    uint public transFees;
    uint public sellFees;
    uint public buyFees;

    constructor(string memory name_) ERC20(name_, name_) {
        mint(msg.sender, 10000000 ether);
    }
    function setDexAgg(address _dexAgg) public {
        dexAgg = _dexAgg;
    }

    function setFees(uint _transFees, uint _sellFees, uint _buyFees) public {
        transFees = _transFees;
        sellFees = _sellFees;
        buyFees = _buyFees;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function _mint(address account, uint256 amount) internal override {
        require(account != address(0), "ERC20: mint to the zero address");
        _totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        address from = _msgSender();
        _transfer(from, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    function _transfer(address from, address to, uint amount) internal override {
        uint256 fromBalance = _balances[from];
        require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");

    unchecked {
        _balances[from] -= amount;
    }
        if (from == dexAgg) {
            amount = amount - (amount * buyFees / 100);
        } else if (to == dexAgg) {
            amount = amount - (amount * sellFees / 100);
        } else {
            amount = amount - (amount * transFees / 100);
        }
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }


}
