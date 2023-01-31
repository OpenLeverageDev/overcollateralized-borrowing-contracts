require("@nomiclabs/hardhat-truffle5");
require("solidity-coverage");
require("hardhat-gas-reporter");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  network: {
    localhost:{
      url: "127.0.0.1:8545"
    },
    hardhat: {
      initialBaseFeePerGas: 0,
      gasPrice: 0,
      gas: 0,
      gasMultiplier: 0,
    }
  },
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000
      }
    }
  },
  gasReporter: {
    currency: "USD",
    showTimeSpent: true,
    excludeContracts: ["Migrations", "mocks/"]
  }
};
