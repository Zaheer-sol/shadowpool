/** Minimal human-readable ABIs for the frontend. */

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function mint(address to, uint256 amount)", // MockERC20 open faucet
];

export const VAULT_ABI = [
  "function deposit(address token, uint256 amount)",
  "function withdraw(address token, uint256 amount)",
  "function totalBalance(address trader, address token) view returns (uint256)",
  "function lockedBalance(address trader, address token) view returns (uint256)",
  "function availableBalance(address trader, address token) view returns (uint256)",
  "event Deposited(address indexed trader, address indexed token, uint256 amount)",
  "event Withdrawn(address indexed trader, address indexed token, uint256 amount)",
];

export const ORDERBOOK_ABI = [
  "function submitOrder(bytes32 pair, bytes encryptedPayload, address depositToken, uint256 depositAmount) returns (bytes32)",
  "function cancelOrder(bytes32 orderId)",
  "function getTraderOrders(address trader) view returns (bytes32[])",
  "function getOrder(bytes32 orderId) view returns (tuple(bytes32 orderId, address trader, bytes32 pair, address depositToken, uint256 depositRemaining, uint64 timestamp, uint8 status, bytes encryptedPayload))",
  "event OrderSubmitted(bytes32 indexed orderId, address indexed trader, bytes32 indexed pair, address depositToken, uint256 depositAmount, bytes encryptedPayload)",
];

export const ORDER_STATUS = ["None", "Active", "Filled", "Cancelled"] as const;
