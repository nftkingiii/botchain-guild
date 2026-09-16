// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {NimSocialEscrow, IERC20Minimal} from "../src/NimSocialEscrow.sol";
interface VmDeploy { function startBroadcast() external; function stopBroadcast() external; }
contract DeployNimSocialEscrow {
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));
    function run(address token) external returns (NimSocialEscrow escrow) {
        require(token != address(0), "explicit token address required");
        vm.startBroadcast(); escrow = new NimSocialEscrow(IERC20Minimal(token)); vm.stopBroadcast();
    }
}
