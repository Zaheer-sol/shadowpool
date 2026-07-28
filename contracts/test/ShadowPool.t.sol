// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {ShadowVault} from "../src/ShadowVault.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {SettlementEngine} from "../src/SettlementEngine.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract ShadowPoolTest is Test {
    ShadowVault vault;
    OrderBook book;
    SettlementEngine engine;
    PriceOracle oracle;
    MockERC20 fxrp;
    MockERC20 usdc;

    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    uint256 teeKey = 0xA11CE;
    address teeSigner;

    bytes32 constant PAIR = keccak256("FXRP/USDC");
    bytes21 constant XRP_FEED = bytes21(bytes("\x01XRP/USD"));
    uint256 constant XRP_PRICE = 3e18; // 3 USDC per FXRP

    function setUp() public {
        teeSigner = vm.addr(teeKey);

        vault = new ShadowVault();
        book = new OrderBook(vault);
        oracle = new PriceOracle(address(0)); // fallback mode (no FTSO locally)
        engine = new SettlementEngine(vault, book, oracle);

        vault.setAuthorized(address(book), true);
        vault.setAuthorized(address(engine), true);
        book.setSettler(address(engine), true);
        engine.setTeeSigner(teeSigner);
        oracle.setFallbackPrice(XRP_FEED, XRP_PRICE);

        fxrp = new MockERC20("FAsset XRP", "FXRP", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        fxrp.mint(seller, 100_000e18);
        usdc.mint(buyer, 500_000e6);

        vm.startPrank(seller);
        fxrp.approve(address(vault), type(uint256).max);
        vault.deposit(address(fxrp), 100_000e18);
        vm.stopPrank();

        vm.startPrank(buyer);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(usdc), 500_000e6);
        vm.stopPrank();
    }

    // ---------- helpers ----------

    function _submit(address trader, address token, uint256 amount) internal returns (bytes32) {
        vm.prank(trader);
        return book.submitOrder(PAIR, hex"deadbeef", token, amount);
    }

    function _instruction(bytes32 buyId, bytes32 sellId, uint256 baseAmt, uint256 quoteAmt, uint256 price)
        internal
        view
        returns (SettlementEngine.SettlementInstruction memory ix)
    {
        ix = SettlementEngine.SettlementInstruction({
            matchId: keccak256(abi.encode(buyId, sellId, baseAmt)),
            buyOrderId: buyId,
            sellOrderId: sellId,
            pair: PAIR,
            baseToken: address(fxrp),
            quoteToken: address(usdc),
            baseAmount: baseAmt,
            quoteAmount: quoteAmt,
            executionPrice: price,
            baseFeedId: XRP_FEED,
            buyFullyFilled: true,
            sellFullyFilled: true,
            timestamp: uint64(block.timestamp)
        });
    }

    function _sign(SettlementEngine.SettlementInstruction memory ix) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encode(block.chainid, address(engine), ix))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teeKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------- vault ----------

    function test_DepositWithdraw() public {
        assertEq(vault.getBalance(seller, address(fxrp)), 100_000e18);
        vm.prank(seller);
        vault.withdraw(address(fxrp), 40_000e18);
        assertEq(vault.getBalance(seller, address(fxrp)), 60_000e18);
        assertEq(fxrp.balanceOf(seller), 40_000e18);
    }

    function test_CannotWithdrawLocked() public {
        _submit(seller, address(fxrp), 100_000e18);
        vm.prank(seller);
        vm.expectRevert();
        vault.withdraw(address(fxrp), 1);
    }

    function test_VaultAuthGuard() public {
        vm.prank(buyer);
        vm.expectRevert(ShadowVault.NotAuthorized.selector);
        vault.lockBalance(seller, address(fxrp), 1e18);
    }

    // ---------- order book ----------

    function test_SubmitLocksCollateral() public {
        bytes32 id = _submit(seller, address(fxrp), 10_000e18);
        assertEq(vault.getLockedBalance(seller, address(fxrp)), 10_000e18);
        OrderBook.EncryptedOrder memory o = book.getOrder(id);
        assertEq(uint8(o.status), uint8(OrderBook.OrderStatus.Active));
        assertEq(o.depositRemaining, 10_000e18);
    }

    function test_CancelUnlocks() public {
        bytes32 id = _submit(seller, address(fxrp), 10_000e18);
        vm.prank(seller);
        book.cancelOrder(id);
        assertEq(vault.getLockedBalance(seller, address(fxrp)), 0);
        assertEq(uint8(book.getOrder(id).status), uint8(OrderBook.OrderStatus.Cancelled));
    }

    function test_OnlyOwnerCancels() public {
        bytes32 id = _submit(seller, address(fxrp), 10_000e18);
        vm.prank(buyer);
        vm.expectRevert(OrderBook.NotOrderOwner.selector);
        book.cancelOrder(id);
    }

    // ---------- settlement ----------

    function test_FullSettlementFlow() public {
        // Seller offers 10,000 FXRP; buyer commits 30,000 USDC (price 3.0).
        bytes32 sellId = _submit(seller, address(fxrp), 10_000e18);
        bytes32 buyId = _submit(buyer, address(usdc), 30_000e6);

        SettlementEngine.SettlementInstruction memory ix =
            _instruction(buyId, sellId, 10_000e18, 30_000e6, XRP_PRICE);
        engine.settle(ix, _sign(ix));

        // Buyer got base, seller got quote; nothing left locked.
        assertEq(vault.getBalance(buyer, address(fxrp)), 10_000e18);
        assertEq(vault.getBalance(seller, address(usdc)), 30_000e6);
        assertEq(vault.getLockedBalance(buyer, address(usdc)), 0);
        assertEq(vault.getLockedBalance(seller, address(fxrp)), 0);
        assertEq(uint8(book.getOrder(buyId).status), uint8(OrderBook.OrderStatus.Filled));
        assertEq(uint8(book.getOrder(sellId).status), uint8(OrderBook.OrderStatus.Filled));
    }

    function test_PartialFillKeepsOrderActive() public {
        bytes32 sellId = _submit(seller, address(fxrp), 10_000e18);
        bytes32 buyId = _submit(buyer, address(usdc), 30_000e6);

        SettlementEngine.SettlementInstruction memory ix =
            _instruction(buyId, sellId, 4_000e18, 12_000e6, XRP_PRICE);
        ix.buyFullyFilled = false;
        ix.sellFullyFilled = false;
        engine.settle(ix, _sign(ix));

        assertEq(uint8(book.getOrder(sellId).status), uint8(OrderBook.OrderStatus.Active));
        assertEq(book.getOrder(sellId).depositRemaining, 6_000e18);
        assertEq(book.getOrder(buyId).depositRemaining, 18_000e6);
        assertEq(vault.getBalance(buyer, address(fxrp)), 4_000e18);
    }

    function test_RejectsBadSignature() public {
        bytes32 sellId = _submit(seller, address(fxrp), 10_000e18);
        bytes32 buyId = _submit(buyer, address(usdc), 30_000e6);
        SettlementEngine.SettlementInstruction memory ix =
            _instruction(buyId, sellId, 10_000e18, 30_000e6, XRP_PRICE);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, engine.instructionDigest(ix));
        vm.expectRevert(SettlementEngine.InvalidAttestation.selector);
        engine.settle(ix, abi.encodePacked(r, s, v));
    }

    function test_RejectsReplay() public {
        bytes32 sellId = _submit(seller, address(fxrp), 10_000e18);
        bytes32 buyId = _submit(buyer, address(usdc), 30_000e6);
        SettlementEngine.SettlementInstruction memory ix =
            _instruction(buyId, sellId, 4_000e18, 12_000e6, XRP_PRICE);
        ix.buyFullyFilled = false;
        ix.sellFullyFilled = false;
        bytes memory sig = _sign(ix);
        engine.settle(ix, sig);
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.AlreadySettled.selector, ix.matchId));
        engine.settle(ix, sig);
    }

    function test_RejectsPriceOutOfBand() public {
        bytes32 sellId = _submit(seller, address(fxrp), 10_000e18);
        bytes32 buyId = _submit(buyer, address(usdc), 30_000e6);
        // 3.30 vs oracle 3.00 → 10% deviation, above the 2% band.
        SettlementEngine.SettlementInstruction memory ix =
            _instruction(buyId, sellId, 9_000e18, 29_700e6, 3.3e18);
        vm.expectRevert(
            abi.encodeWithSelector(SettlementEngine.PriceOutOfBand.selector, 3.3e18, XRP_PRICE)
        );
        engine.settle(ix, _sign(ix));
    }

    function test_RejectsOverfill() public {
        // Enclave tries to move more quote than the buyer locked.
        bytes32 sellId = _submit(seller, address(fxrp), 10_000e18);
        bytes32 buyId = _submit(buyer, address(usdc), 15_000e6);
        SettlementEngine.SettlementInstruction memory ix =
            _instruction(buyId, sellId, 10_000e18, 30_000e6, XRP_PRICE);
        vm.expectRevert();
        engine.settle(ix, _sign(ix));
    }

    function test_RejectsSettleOfCancelledOrder() public {
        bytes32 sellId = _submit(seller, address(fxrp), 10_000e18);
        bytes32 buyId = _submit(buyer, address(usdc), 30_000e6);
        vm.prank(seller);
        book.cancelOrder(sellId);
        SettlementEngine.SettlementInstruction memory ix =
            _instruction(buyId, sellId, 10_000e18, 30_000e6, XRP_PRICE);
        vm.expectRevert(abi.encodeWithSelector(SettlementEngine.OrderInactive.selector, sellId));
        engine.settle(ix, _sign(ix));
    }

    // ---------- oracle ----------

    function test_SlippageMath() public view {
        assertTrue(oracle.isWithinSlippage(3e18, 3.05e18, 200)); // 1.67% ok
        assertFalse(oracle.isWithinSlippage(3e18, 3.30e18, 200)); // 10% not ok
    }
}
