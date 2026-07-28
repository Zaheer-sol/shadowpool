// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {ShadowVault} from "../src/ShadowVault.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {SettlementEngine} from "../src/SettlementEngine.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Deploys the full ShadowPool stack plus test tokens.
///
/// Local:    forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
/// Coston2:  forge script script/Deploy.s.sol --rpc-url coston2 --broadcast
///
/// Env:
///   PRIVATE_KEY   deployer key (defaults to anvil #0 when unset)
///   TEE_SIGNER    enclave signing address (defaults to deployer; the relay prints its own)
contract Deploy is Script {
    // FlareContractRegistry — same address on every Flare network.
    address constant FLARE_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    // Coston2 chain id.
    uint256 constant COSTON2 = 114;
    // FTSO v2 feed id for XRP/USD ("01" category + "XRP/USD" padded).
    bytes21 constant XRP_FEED = 0x015852502f55534400000000000000000000000000;

    function run() external {
        uint256 pk = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // anvil #0
        );
        address deployer = vm.addr(pk);
        address teeSigner = vm.envOr("TEE_SIGNER", deployer);
        bool onFlare = block.chainid == COSTON2 || block.chainid == 14 || block.chainid == 19;

        vm.startBroadcast(pk);

        ShadowVault vault = new ShadowVault();
        OrderBook book = new OrderBook(vault);
        PriceOracle oracle = new PriceOracle(onFlare ? FLARE_REGISTRY : address(0));
        SettlementEngine engine = new SettlementEngine(vault, book, oracle);

        vault.setAuthorized(address(book), true);
        vault.setAuthorized(address(engine), true);
        book.setSettler(address(engine), true);
        engine.setTeeSigner(teeSigner);

        // Test tokens (Coston2 has no canonical FXRP/USDC for hackathon use).
        MockERC20 fxrp = new MockERC20("FAsset XRP", "FXRP", 18);
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);

        if (!onFlare) {
            // Local chain: seed a fallback price so the band check works end to end.
            oracle.setFallbackPrice(XRP_FEED, 3e18);
        }

        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("deployer         ", deployer);
        console.log("teeSigner        ", teeSigner);
        console.log("ShadowVault      ", address(vault));
        console.log("OrderBook        ", address(book));
        console.log("SettlementEngine ", address(engine));
        console.log("PriceOracle      ", address(oracle));
        console.log("FXRP             ", address(fxrp));
        console.log("USDC             ", address(usdc));

        // Machine-readable deployment record for the services + frontend.
        _writeDeployment(
            [address(vault), address(book), address(engine), address(oracle), address(fxrp), address(usdc), teeSigner]
        );
    }

    function _writeDeployment(address[7] memory a) internal {
        string memory head = string.concat(
            '{"chainId":', vm.toString(block.chainid),
            ',"vault":"', vm.toString(a[0]),
            '","orderBook":"', vm.toString(a[1]),
            '","settlementEngine":"', vm.toString(a[2])
        );
        string memory tail = string.concat(
            '","priceOracle":"', vm.toString(a[3]),
            '","fxrp":"', vm.toString(a[4]),
            '","usdc":"', vm.toString(a[5]),
            '","teeSigner":"', vm.toString(a[6]), '"}'
        );
        vm.writeFile(
            string.concat("deployments/", vm.toString(block.chainid), ".json"), string.concat(head, tail)
        );
    }
}
