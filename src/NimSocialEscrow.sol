// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20Minimal { function transferFrom(address from, address to, uint256 amount) external returns (bool); function transfer(address to, uint256 amount) external returns (bool); }

contract NimSocialEscrow {
    uint256 private _entered;
    modifier nonReentrant() { require(_entered == 0, "reentrant"); _entered = 1; _; _entered = 0; }

    enum State {
        None,
        Funded,
        Submitted,
        Disputed,
        Released,
        Refunded
    }

    struct Job {
        address client;
        address worker;
        address arbiter;
        uint128 amount;
        uint64 deadline;
        uint64 submittedAt;
        State state;
        bytes32 evidenceHash;
    }

    IERC20Minimal public immutable paymentToken;
    mapping(bytes32 jobId => Job) private jobs;

    error AlreadyExists();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidState(State expected, State actual);
    error NotAuthorized();
    error DeadlineNotReached();
    error ReviewPeriodNotReached();

    uint64 public constant REVIEW_PERIOD = 3 days;

    event JobFunded(
        bytes32 indexed jobId,
        address indexed client,
        address indexed worker,
        uint256 amount,
        uint64 deadline,
        address arbiter
    );
    event EvidenceSubmitted(bytes32 indexed jobId, bytes32 indexed evidenceHash);
    event DisputeOpened(bytes32 indexed jobId, address indexed openedBy);
    event JobReleased(bytes32 indexed jobId, address indexed worker, uint256 amount);
    event JobRefunded(bytes32 indexed jobId, address indexed client, uint256 amount, bool timedOut);

    constructor(IERC20Minimal token) {
        if (address(token) == address(0)) revert InvalidAddress();
        paymentToken = token;
    }

    function fundJob(bytes32 jobId, address worker, address arbiter, uint128 amount, uint64 deadline)
        external
        nonReentrant
    {
        if (jobs[jobId].state != State.None) revert AlreadyExists();
        if (
            worker == address(0) || arbiter == address(0) || worker == msg.sender || arbiter == msg.sender
                || arbiter == worker
        ) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        jobs[jobId] = Job({
            client: msg.sender,
            worker: worker,
            arbiter: arbiter,
            amount: amount,
            deadline: deadline,
            submittedAt: 0,
            state: State.Funded,
            evidenceHash: bytes32(0)
        });

        require(paymentToken.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit JobFunded(jobId, msg.sender, worker, amount, deadline, arbiter);
    }

    function submitEvidence(bytes32 jobId, bytes32 evidenceHash) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.worker) revert NotAuthorized();
        if (job.state != State.Funded) revert InvalidState(State.Funded, job.state);
        if (block.timestamp > job.deadline) revert InvalidDeadline();
        if (evidenceHash == bytes32(0)) revert InvalidAmount();
        job.evidenceHash = evidenceHash;
        job.submittedAt = uint64(block.timestamp);
        job.state = State.Submitted;
        emit EvidenceSubmitted(jobId, evidenceHash);
    }

    function approve(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotAuthorized();
        if (job.state != State.Submitted) revert InvalidState(State.Submitted, job.state);
        job.state = State.Released;
        require(paymentToken.transfer(job.worker, job.amount), "transfer failed");
        emit JobReleased(jobId, job.worker, job.amount);
    }

    function openDispute(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client && msg.sender != job.worker) revert NotAuthorized();
        if (job.state != State.Submitted) revert InvalidState(State.Submitted, job.state);
        job.state = State.Disputed;
        emit DisputeOpened(jobId, msg.sender);
    }

    function claimAfterReviewPeriod(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.worker) revert NotAuthorized();
        if (job.state != State.Submitted) revert InvalidState(State.Submitted, job.state);
        if (block.timestamp <= job.submittedAt + REVIEW_PERIOD) revert ReviewPeriodNotReached();
        job.state = State.Released;
        require(paymentToken.transfer(job.worker, job.amount), "transfer failed");
        emit JobReleased(jobId, job.worker, job.amount);
    }

    function resolveDispute(bytes32 jobId, bool releaseToWorker) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.arbiter) revert NotAuthorized();
        if (job.state != State.Disputed) revert InvalidState(State.Disputed, job.state);

        if (releaseToWorker) {
            job.state = State.Released;
            require(paymentToken.transfer(job.worker, job.amount), "transfer failed");
            emit JobReleased(jobId, job.worker, job.amount);
        } else {
            job.state = State.Refunded;
            require(paymentToken.transfer(job.client, job.amount), "transfer failed");
            emit JobRefunded(jobId, job.client, job.amount, false);
        }
    }

    function refundAfterDeadline(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotAuthorized();
        if (job.state != State.Funded) revert InvalidState(State.Funded, job.state);
        if (block.timestamp <= job.deadline) revert DeadlineNotReached();
        job.state = State.Refunded;
        require(paymentToken.transfer(job.client, job.amount), "transfer failed");
        emit JobRefunded(jobId, job.client, job.amount, true);
    }

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
}
