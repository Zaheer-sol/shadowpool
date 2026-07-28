// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ShadowVault} from "./ShadowVault.sol";

/// @title OrderBook
/// @notice Receives encrypted orders and emits events for the TEE relay. The contract
///         never sees order contents — direction, size, and price live only inside the
///         enclave. What is public: who posted a blob, for which pair, and the collateral
///         locked behind it.
contract OrderBook is Ownable {
    enum OrderStatus {
        None,
        Active,
        Filled,
        Cancelled
    }

    struct EncryptedOrder {
        bytes32 orderId;
        address trader;
        bytes32 pair; // keccak256("FXRP/USDC") — public so the enclave routes to the right book
        address depositToken; // collateral token locked behind this order
        uint256 depositRemaining; // collateral not yet consumed by fills
        uint64 timestamp;
        OrderStatus status;
        bytes encryptedPayload; // NaCl box ciphertext, readable only by the enclave
    }

    ShadowVault public immutable vault;
    /// @notice SettlementEngine allowed to consume deposits / mark fills.
    mapping(address => bool) public settlers;

    mapping(bytes32 => EncryptedOrder) internal orders;
    mapping(address => bytes32[]) internal traderOrders;
    uint256 public orderCount;

    event OrderSubmitted(
        bytes32 indexed orderId,
        address indexed trader,
        bytes32 indexed pair,
        address depositToken,
        uint256 depositAmount,
        bytes encryptedPayload
    );
    event OrderCancelled(bytes32 indexed orderId, address indexed trader);
    event OrderFilled(bytes32 indexed orderId);
    event SettlerSet(address indexed settler, bool allowed);

    error NotSettler();
    error NotOrderOwner();
    error OrderNotActive();
    error EmptyPayload();
    error ZeroDeposit();
    error ConsumeExceedsDeposit();

    modifier onlySettler() {
        if (!settlers[msg.sender]) revert NotSettler();
        _;
    }

    constructor(ShadowVault vault_) Ownable(msg.sender) {
        vault = vault_;
    }

    function setSettler(address settler, bool allowed) external onlyOwner {
        settlers[settler] = allowed;
        emit SettlerSet(settler, allowed);
    }

    /// @notice Submit an encrypted order. Locks `depositAmount` of `depositToken` in the
    ///         vault as collateral (quote token for buys, base token for sells — but which
    ///         it is stays private to observers who don't already know the direction).
    function submitOrder(
        bytes32 pair,
        bytes calldata encryptedPayload,
        address depositToken,
        uint256 depositAmount
    ) external returns (bytes32 orderId) {
        if (encryptedPayload.length == 0) revert EmptyPayload();
        if (depositAmount == 0) revert ZeroDeposit();

        orderId = keccak256(abi.encodePacked(block.chainid, address(this), msg.sender, ++orderCount));

        vault.lockBalance(msg.sender, depositToken, depositAmount);

        orders[orderId] = EncryptedOrder({
            orderId: orderId,
            trader: msg.sender,
            pair: pair,
            depositToken: depositToken,
            depositRemaining: depositAmount,
            timestamp: uint64(block.timestamp),
            status: OrderStatus.Active,
            encryptedPayload: encryptedPayload
        });
        traderOrders[msg.sender].push(orderId);

        emit OrderSubmitted(orderId, msg.sender, pair, depositToken, depositAmount, encryptedPayload);
    }

    /// @notice Cancel an active order and unlock its remaining collateral.
    function cancelOrder(bytes32 orderId) external {
        EncryptedOrder storage order = orders[orderId];
        if (order.trader != msg.sender) revert NotOrderOwner();
        if (order.status != OrderStatus.Active) revert OrderNotActive();

        order.status = OrderStatus.Cancelled;
        if (order.depositRemaining > 0) {
            vault.unlockBalance(order.trader, order.depositToken, order.depositRemaining);
            order.depositRemaining = 0;
        }
        emit OrderCancelled(orderId, msg.sender);
    }

    /// @notice Called by SettlementEngine when a fill consumes part of an order's
    ///         collateral. Marks the order Filled when the enclave says it's done.
    function consumeDeposit(bytes32 orderId, uint256 amount, bool fullyFilled) external onlySettler {
        EncryptedOrder storage order = orders[orderId];
        if (order.status != OrderStatus.Active) revert OrderNotActive();
        if (amount > order.depositRemaining) revert ConsumeExceedsDeposit();

        order.depositRemaining -= amount;

        if (fullyFilled) {
            order.status = OrderStatus.Filled;
            // Dust left from rounding or a partial final fill goes back to the trader.
            if (order.depositRemaining > 0) {
                vault.unlockBalance(order.trader, order.depositToken, order.depositRemaining);
                order.depositRemaining = 0;
            }
            emit OrderFilled(orderId);
        }
    }

    function getOrder(bytes32 orderId) external view returns (EncryptedOrder memory) {
        return orders[orderId];
    }

    function getTraderOrders(address trader) external view returns (bytes32[] memory) {
        return traderOrders[trader];
    }

    function isActive(bytes32 orderId) external view returns (bool) {
        return orders[orderId].status == OrderStatus.Active;
    }
}
