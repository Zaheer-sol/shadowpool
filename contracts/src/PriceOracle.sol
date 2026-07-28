// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFtsoV2, IFlareContractRegistry} from "./interfaces/IFtsoV2.sol";

/// @title PriceOracle
/// @notice Thin wrapper over Flare's FtsoV2 that normalises every feed to 18 decimals.
///         When deployed on a chain without FTSO (local anvil), it falls back to
///         owner-set prices so the same interface works everywhere.
contract PriceOracle is Ownable {
    /// @dev FlareContractRegistry lives at the same address on all Flare networks.
    IFlareContractRegistry public immutable registry;

    struct StoredPrice {
        uint256 value; // 18 decimals
        uint64 timestamp;
    }

    /// @notice Fallback prices for chains without FTSO, keyed by feed id.
    mapping(bytes21 => StoredPrice) public fallbackPrices;
    /// @notice Force fallback mode even if a registry address is set.
    bool public useFallback;

    event FallbackPriceSet(bytes21 indexed feedId, uint256 value);
    event FallbackModeSet(bool enabled);

    error StalePrice(bytes21 feedId);
    error NoPrice(bytes21 feedId);

    constructor(address registry_) Ownable(msg.sender) {
        registry = IFlareContractRegistry(registry_);
        useFallback = registry_ == address(0);
    }

    function setFallbackMode(bool enabled) external onlyOwner {
        useFallback = enabled;
        emit FallbackModeSet(enabled);
    }

    function setFallbackPrice(bytes21 feedId, uint256 value) external onlyOwner {
        fallbackPrices[feedId] = StoredPrice({value: value, timestamp: uint64(block.timestamp)});
        emit FallbackPriceSet(feedId, value);
    }

    /// @notice Current price for a feed, normalised to 18 decimals.
    function getPrice(bytes21 feedId) public returns (uint256 value, uint64 timestamp) {
        if (useFallback) {
            StoredPrice memory p = fallbackPrices[feedId];
            if (p.value == 0) revert NoPrice(feedId);
            return (p.value, p.timestamp);
        }
        IFtsoV2 ftso = IFtsoV2(registry.getContractAddressByName("FtsoV2"));
        (uint256 raw, int8 decimals, uint64 ts) = ftso.getFeedById(feedId);
        // Normalise to 18 decimals. FTSO decimals can be negative (value is scaled up).
        if (decimals >= 0) {
            value = raw * (10 ** (18 - uint8(decimals)));
        } else {
            value = raw * (10 ** (18 + uint8(-decimals)));
        }
        return (value, ts);
    }

    /// @notice Convert `sourceAmount` priced by `sourceFeedId` into the unit of `destFeedId`.
    function getQuote(bytes21 sourceFeedId, bytes21 destFeedId, uint256 sourceAmount)
        external
        returns (uint256)
    {
        (uint256 src,) = getPrice(sourceFeedId);
        (uint256 dst,) = getPrice(destFeedId);
        return (sourceAmount * src) / dst;
    }

    /// @notice True if `actual` is within `maxBps` basis points of `expected`.
    function isWithinSlippage(uint256 expected, uint256 actual, uint256 maxBps) public pure returns (bool) {
        uint256 diff = expected > actual ? expected - actual : actual - expected;
        return diff * 10_000 <= expected * maxBps;
    }
}
