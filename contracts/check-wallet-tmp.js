require("dotenv").config();
const { ethers } = require("ethers");

const claimedAddress = "0xaF93Afa080D5b6FBdfB01b4AdD2afd63f8B3442e";
const pk = process.env.DEPLOYER_PRIVATE_KEY;
const wallet = new ethers.Wallet(pk.startsWith("0x") ? pk : "0x" + pk);

console.log("Derived address:", wallet.address);
console.log("Matches claimed address:", wallet.address.toLowerCase() === claimedAddress.toLowerCase());

const provider = new ethers.JsonRpcProvider(process.env.BSC_TESTNET_RPC_URL);
provider.getBalance(wallet.address).then((bal) => {
  console.log("tBNB balance:", ethers.formatEther(bal));
  process.exit(0);
}).catch((e) => {
  console.error("RPC error:", e.message);
  process.exit(1);
});
