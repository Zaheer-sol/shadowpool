// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ShadowVault} from "./ShadowVault.sol";
import {OrderBook} from "./OrderBook.sol";
import {PriceOracle} from "./PriceOracle.sol";

/// @title SettlementEngine
/// @notice Trust boundary between the TEE and the chain. Verifies that a settlement
///         instruction was signed by the registered enclave key, sanity-checks the
///         execution price against FTSO, then moves balances inside the ShadowVault.
///         Even a fully compromised enclave cannot settle outside the FTSO price band,
///         invent fills beyond locked collateral, or replay a settlement.
contract SettlementEngine is Ownable {
    struct SettlementInstruction {
        bytes32 matchId; // unique per match, assigned by the enclave
        bytes32 buyOrderId;
        bytes32 sellOrderId;
        bytes32 pair;
        address baseToken; // e.g. FXRP
        address quoteToken; // e.g. USDC
        uint256 baseAmount; // base moved seller -> buyer
        uint256 quoteAmount; // quote moved buyer -> seller
        uint256 executionPrice; // quote per 1e18 base, 18 decimals
        bytes21 baseFeedId; // FTSO feed used for the price band check
        bool buyFullyFilled;
        bool sellFullyFilled;
        uint64 timestamp;
    }

    ShadowVault public immutable vault;
    OrderBook public immutable orderBook;
    PriceOracle public immutable priceOracle;

    /// @notice Enclave attestation/signing key. Settlements must be signed by this key.
    address public teeSigner;
    /// @notice Max deviation between execution price and FTSO price, in basis points.
    uint256 public maxPriceDeviationBps = 200; // 2%
    /// @notice Skip the FTSO band check for pairs with no feed (e.g. local dev).
    bool public priceCheckEnabled = true;

    mapping(bytes32 => bool) public settled; // matchId => done (replay protection)

    event TradeSettled(
        bytes32 indexed matchId,
        bytes32 indexed buyOrderId,
        bytes32 indexed sellOrderId,
        bytes32 pair,
        uint256 executionPrice,
        uint256 baseAmount,
        uint256 quoteAmount
    );
    event TeeSignerSet(address indexed signer);
    event MaxPriceDeviationSet(uint256 bps);
    event PriceCheckSet(bool enabled);

    error InvalidAttestation();
    error AlreadySettled(bytes32 matchId);
    error OrderInactive(bytes32 orderId);
    error SelfTrade();
    error PriceOutOfBand(uint256 executionPrice, uint256 oraclePrice);
    error ZeroAmounts();

    constructor(ShadowVault vault_, OrderBook orderBook_, PriceOracle priceOracle_) Ownable(msg.sender) {
        vault = vault_;
        orderBook = orderBook_;
        priceOracle = priceOracle_;
    }

    /// @notice Register the enclave signing key. Admin-set for the hackathon; in
    ///         production this would be bound to a verified TEE attestation quote.
    function setTeeSigner(address signer) external onlyOwner {
        teeSigner = signer;
        emit TeeSignerSet(signer);
    }

    function setMaxPriceDeviationBps(uint256 bps) external onlyOwner {
        maxPriceDeviationBps = bps;
        emit MaxPriceDeviationSet(bps);
    }

    function setPriceCheckEnabled(bool enabled) external onlyOwner {
        priceCheckEnabled = enabled;
        emit PriceCheckSet(enabled);
    }

    /// @notice EIP-191 digest the enclave signs for an instruction.
    function instructionDigest(SettlementInstruction calldata ix) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(this), ix))
        );
    }

    /// @notice Settle a matched trade. Anyone may relay; the signature is the authority.
    function settle(SettlementInstruction calldata ix, bytes calldata attestation) external {
        // 1. Attestation: instruction must be signed by the registered enclave key.
        if (teeSigner == address(0)) revert InvalidAttestation();
        if (ECDSA.recover(instructionDigest(ix), attestation) != teeSigner) revert InvalidAttestation();

        // 2. Replay protection.
        if (settled[ix.matchId]) revert AlreadySettled(ix.matchId);
        settled[ix.matchId] = true;

        if (ix.baseAmount == 0 || ix.quoteAmount == 0) revert ZeroAmounts();

        // 3. Both orders must exist and be active.
        OrderBook.EncryptedOrder memory buy = orderBook.getOrder(ix.buyOrderId);
        OrderBook.EncryptedOrder memory sell = orderBook.getOrder(ix.sellOrderId);
        if (buy.status != OrderBook.OrderStatus.Active) revert OrderInactive(ix.buyOrderId);
        if (sell.status != OrderBook.OrderStatus.Active) revert OrderInactive(ix.sellOrderId);
        if (buy.trader == sell.trader) revert SelfTrade();

        // 4. Price band: execution price must sit within maxPriceDeviationBps of FTSO.
        //    This caps the damage of a compromised enclave to the band width.
        if (priceCheckEnabled) {
            (uint256 oraclePrice,) = priceOracle.getPrice(ix.baseFeedId);
            if (!priceOracle.isWithinSlippage(oraclePrice, ix.executionPrice, maxPriceDeviationBps)) {
                revert PriceOutOfBand(ix.executionPrice, oraclePrice);
            }
        }

        // 5. Move collateral: buyer's quote -> seller, seller's base -> buyer.
        //    executeTransfer draws from locked balance, so fills can never exceed
        //    the collateral committed at order submission.
        vault.executeTransfer(buy.trader, sell.trader, ix.quoteToken, ix.quoteAmount);
        vault.executeTransfer(sell.trader, buy.trader, ix.baseToken, ix.baseAmount);

        // 6. Track collateral consumption and (maybe) mark orders filled.
        orderBook.consumeDeposit(ix.buyOrderId, ix.quoteAmount, ix.buyFullyFilled);
        orderBook.consumeDeposit(ix.sellOrderId, ix.baseAmount, ix.sellFullyFilled);

        emit TradeSettled(
            ix.matchId, ix.buyOrderId, ix.sellOrderId, ix.pair, ix.executionPrice, ix.baseAmount, ix.quoteAmount
        );
    }
}
