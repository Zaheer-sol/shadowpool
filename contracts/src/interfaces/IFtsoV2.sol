// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Minimal interface for Flare's FtsoV2 feed reader.
interface IFtsoV2 {
    function getFeedById(bytes21 feedId)
        external
        payable
        returns (uint256 value, int8 decimals, uint64 timestamp);
}

/// @notice Minimal interface for the FlareContractRegistry.
interface IFlareContractRegistry {
    function getContractAddressByName(string calldata name) external view returns (address);
}
