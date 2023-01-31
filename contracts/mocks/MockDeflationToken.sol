// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockDeflationToken is ERC20 {
    uint deflationRatio = 100;
    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;

    constructor(string memory name_) ERC20(name_, name_) {
        mint(msg.sender, 10000000 ether);
    }

    function setDeflationRatio(uint _deflationRatio) public {
        deflationRatio = _deflationRatio;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function _mint(address account, uint256 amount) internal override {
        require(account != address(0), "ERC20: mint to the zero address");
        _totalSupply += ((amount) * 100 + deflationRatio - 1) / deflationRatio;
        _balances[account] += ((amount) * 100 + deflationRatio - 1) / deflationRatio;
        emit Transfer(address(0), account, amount);
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balanceOf(account);
    }

    function _balanceOf(address account) internal view returns (uint256) {
        return (_balances[account] * deflationRatio) / 100;
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

    function _transfer(address from, address to, uint amount) internal override {
        uint256 fromBalance = _balanceOf(from);
        require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");
        uint rawAmount = ((amount) * 100 + deflationRatio - 1) / deflationRatio;
        unchecked {
            _balances[from] -= rawAmount;
        }
        _balances[to] += rawAmount;

        emit Transfer(from, to, amount);
    }
}
