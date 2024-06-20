export interface SyncInfo {
    latest_block_hash: string;
    latest_block_height: number;
    latest_block_time: string;
    latest_state_root: string;
    syncing: boolean;
}
interface Version {
    version: string;
    build: string;
}
export interface NodeStatusResult {
    chain_id: string;
    rpc_addr: string;
    sync_info: SyncInfo;
    validators: string[];
    version: Version;
}
declare type BlockHash = string;
declare type BlockHeight = number;
export declare type BlockId = BlockHash | BlockHeight;
export declare type Finality = 'optimistic' | 'unc-final' | 'final';
export declare type TxExecutionStatus = 'NONE' | 'INCLUDED' | 'INCLUDED_FINAL' | 'EXECUTED' | 'FINAL' | 'EXECUTED_OPTIMISTIC';
export declare type BlockReference = {
    blockId: BlockId;
} | {
    finality: Finality;
} | {
    sync_checkpoint: 'genesis' | 'earliest_available';
};
export enum ExecutionStatusBasic {
    Unknown = "Unknown",
    Pending = "Pending",
    Failure = "Failure"
}
export interface ExecutionStatus {
    SuccessValue?: string;
    SuccessReceiptId?: string;
    Failure?: ExecutionError;
}

export interface ExecutionError {
    error_message: string;
    error_type: string;
}
export interface FinalExecutionStatus {
    SuccessValue?: string;
    Failure?: ExecutionError;
}
export interface ExecutionOutcomeWithId {
    id: string;
    outcome?: ExecutionOutcome;
}
export interface ExecutionOutcome {
    logs: string[];
    receipt_ids: string[];
    gas_burnt: number;
    tokens_burnt: string;
    executor_id: string;
    status: ExecutionStatus | ExecutionStatusBasic;
}
export interface FinalExecutionOutcome {
    final_execution_status: TxExecutionStatus;
    status: FinalExecutionStatus | ExecutionStatusBasic;
    transaction: any;
    transaction_outcome: ExecutionOutcomeWithId;
    receipts_outcome: ExecutionOutcomeWithId[];
}
