// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Re-exported so the offline compile script (which only compiles files listed as
// targets, not arbitrary node_modules paths) produces an artifact for it. Used
// unmodified as the owner of ReservedToken/ReservedVault — see
// scripts/deploy-timelock.ts.
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
