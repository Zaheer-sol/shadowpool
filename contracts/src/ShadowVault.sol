// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ShadowVault
/// @notice Escrow for trader deposits. All ShadowPool trading settles against vault
///         balances, never wallet balances. Deposits/withdrawals are public; what the
///         balances are being traded for is not.
contract ShadowVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice trader => token => total balance held in the vault.
    mapping(address => mapping(address => uint256)) public totalBalance;
    /// @notice trader => token => portion of totalBalance locked behind active orders.
    mapping(address => mapping(address => uint256)) public lockedBalance;
    /// @notice Contracts allowed to lock/unlock/transfer balances (OrderBook, SettlementEngine).
    mapping(address => bool) public authorized;

    event Deposited(address indexed trader, address indexed token, uint256 amount);
    event Withdrawn(address indexed trader, address indexed token, uint256 amount);
    event BalanceLocked(address indexed trader, address indexed token, uint256 amount);
    event BalanceUnlocked(address indexed trader, address indexed token, uint256 amount);
    event TransferExecuted(address indexed from, address indexed to, address indexed token, uint256 amount);
    event AuthorizedSet(address indexed account, bool isAuthorized);

    error NotAuthorized();
    error ZeroAmount();
    error InsufficientAvailable(uint256 requested, uint256 available);
    error InsufficientLocked(uint256 requested, uint256 locked);

    modifier onlyAuthorized() {
        if (!authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setAuthorized(address account, bool isAuthorized) external onlyOwner {
        authorized[account] = isAuthorized;
        emit AuthorizedSet(account, isAuthorized);
    }

    /// @notice Deposit ERC-20 tokens into the vault. Requires prior approval.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20 erc20 = IERC20(token);
        uint256 before = erc20.balanceOf(address(this));
        erc20.safeTransferFrom(msg.sender, address(this), amount);
        // Credit what actually arrived so fee-on-transfer tokens can't inflate balances.
        uint256 received = erc20.balanceOf(address(this)) - before;
        totalBalance[msg.sender][token] += received;
        emit Deposited(msg.sender, token, received);
    }

    /// @notice Withdraw unlocked balance back to the trader's wallet.
    function withdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = availableBalance(msg.sender, token);
        if (amount > available) revert InsufficientAvailable(amount, available);
        totalBalance[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Lock balance behind a newly placed order. Only OrderBook.
    function lockBalance(address trader, address token, uint256 amount) external onlyAuthorized {
        uint256 available = availableBalance(trader, token);
        if (amount > available) revert InsufficientAvailable(amount, available);
        lockedBalance[trader][token] += amount;
        emit BalanceLocked(trader, token, amount);
    }

    /// @notice Release locked balance when an order is cancelled or expires.
    function unlockBalance(address trader, address token, uint256 amount) external onlyAuthorized {
        uint256 locked = lockedBalance[trader][token];
        if (amount > locked) revert InsufficientLocked(amount, locked);
        lockedBalance[trader][token] = locked - amount;
        emit BalanceUnlocked(trader, token, amount);
    }

    /// @notice Settle a matched trade: move `amount` of `token` out of `from`'s locked
    ///         balance into `to`'s available balance. Only SettlementEngine.
    function executeTransfer(address from, address to, address token, uint256 amount) external onlyAuthorized {
        uint256 locked = lockedBalance[from][token];
        if (amount > locked) revert InsufficientLocked(amount, locked);
        lockedBalance[from][token] = locked - amount;
        totalBalance[from][token] -= amount;
        totalBalance[to][token] += amount;
        emit TransferExecuted(from, to, token, amount);
    }

    /// @notice Balance a trader can withdraw or back new orders with.
    function availableBalance(address trader, address token) public view returns (uint256) {
        return totalBalance[trader][token] - lockedBalance[trader][token];
    }

    function getBalance(address trader, address token) external view returns (uint256) {
        return availableBalance(trader, token);
    }

    function getLockedBalance(address trader, address token) external view returns (uint256) {
        return lockedBalance[trader][token];
    }
}
