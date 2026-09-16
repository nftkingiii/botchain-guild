// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {NimSocialEscrow} from "../src/NimSocialEscrow.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

interface Vm {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

contract NimSocialEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDT private token;
    NimSocialEscrow private escrow;
    address private client = address(0xC11E17);
    address private worker = address(0xB0B);
    address private arbiter = address(0xA11CE);
    address private attacker = address(0xBAD);
    bytes32 private jobId = keccak256("job-1");
    uint128 private constant AMOUNT = 100e6;

    function setUp() public {
        token = new MockUSDT();
        escrow = new NimSocialEscrow(token);
        token.mint(client, AMOUNT * 10);
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
    }

    function assertEq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "assertEq failed");
    }

    function _fund() private {
        vm.prank(client);
        escrow.fundJob(jobId, worker, arbiter, AMOUNT, uint64(block.timestamp + 7 days));
    }

    function testCompleteJobReleasesExactAmount() public {
        _fund();
        bytes32 proofHash = keccak256("deliverable");
        vm.prank(worker);
        escrow.submitEvidence(jobId, proofHash);
        vm.prank(client);
        escrow.approve(jobId);

        assertEq(token.balanceOf(worker), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getJob(jobId).state), uint8(NimSocialEscrow.State.Released));
    }

    function testTimeoutRefundRequiresDeadline() public {
        _fund();
        vm.prank(client);
        vm.expectRevert(NimSocialEscrow.DeadlineNotReached.selector);
        escrow.refundAfterDeadline(jobId);

        vm.warp(block.timestamp + 8 days);
        vm.prank(client);
        escrow.refundAfterDeadline(jobId);
        assertEq(token.balanceOf(client), AMOUNT * 10);
    }

    function testArbiterCanRefundDisputedSubmission() public {
        _fund();
        vm.prank(worker);
        escrow.submitEvidence(jobId, keccak256("bad-deliverable"));
        vm.prank(client);
        escrow.openDispute(jobId);
        vm.prank(arbiter);
        escrow.resolveDispute(jobId, false);

        assertEq(token.balanceOf(client), AMOUNT * 10);
        assertEq(uint8(escrow.getJob(jobId).state), uint8(NimSocialEscrow.State.Refunded));
    }

    function testStrangerCannotResolveDispute() public {
        _fund();
        vm.prank(worker);
        escrow.submitEvidence(jobId, keccak256("proof"));
        vm.prank(client);
        escrow.openDispute(jobId);
        vm.prank(attacker);
        vm.expectRevert(NimSocialEscrow.NotAuthorized.selector);
        escrow.resolveDispute(jobId, true);
    }

    function testWorkerCannotSubmitAfterDeadline() public {
        _fund();
        vm.warp(block.timestamp + 8 days);
        vm.prank(worker);
        vm.expectRevert(NimSocialEscrow.InvalidDeadline.selector);
        escrow.submitEvidence(jobId, keccak256("late-proof"));
    }

    function testCannotReuseJobId() public {
        _fund();
        vm.prank(client);
        vm.expectRevert(NimSocialEscrow.AlreadyExists.selector);
        escrow.fundJob(jobId, worker, arbiter, AMOUNT, uint64(block.timestamp + 7 days));
    }

    function testArbiterCannotBeAJobParty() public {
        vm.prank(client);
        vm.expectRevert(NimSocialEscrow.InvalidAddress.selector);
        escrow.fundJob(jobId, worker, worker, AMOUNT, uint64(block.timestamp + 7 days));
    }

    function testWorkerCanClaimAfterClientReviewTimeout() public {
        _fund();
        vm.prank(worker);
        escrow.submitEvidence(jobId, keccak256("complete-proof"));

        vm.prank(worker);
        vm.expectRevert(NimSocialEscrow.ReviewPeriodNotReached.selector);
        escrow.claimAfterReviewPeriod(jobId);

        vm.warp(block.timestamp + escrow.REVIEW_PERIOD() + 1);
        vm.prank(worker);
        escrow.claimAfterReviewPeriod(jobId);
        assertEq(token.balanceOf(worker), AMOUNT);
    }
}
