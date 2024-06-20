//----------------------------------
// MetaStaking POOL smart-contract proxy for
// https://github.com/Mywallets/meta-pool
//----------------------------------

import { ntoy, TGas } from "../util/conversions.js"
import { SmartContract, U128String } from "./base-smart-contract.js"

import type { ContractInfo } from "./NEP129.js"
import { MetaPoolContractState, GetAccountInfoResult, LiquidUnstakeResult, RemoveLiquidityResult, VLoanInfo } from "./meta-pool-structs.js"

//singleton class
export class MetaPool extends SmartContract {

    /// returns JSON string according to [NEP-129](https://github.com/uncprotocol/NEPs/pull/129)
    get_contract_info(): Promise<ContractInfo> {
        return this.view("get_contract_info")
    }

    get_contract_state(): Promise<MetaPoolContractState> {
        return this.view("get_contract_state")
    }

    //get account info from current connected user account
    get_account_info(accountId?: string): Promise<GetAccountInfoResult> {
        return this.view("get_account_info", { account_id: accountId || this.signerId })
    }

    deposit(uncsToDeposit: number): Promise<void> {
        return this.call("deposit", {}, TGas(25), ntoy(uncsToDeposit))
    }
    withdraw(uncsToWithdraw: number): Promise<void> {
        return this.call("withdraw", { amount: ntoy(uncsToWithdraw) })
    }

    deposit_and_stake(uncsToDeposit: number): Promise<void> {
        return this.call("deposit_and_stake", {}, TGas(50), ntoy(uncsToDeposit))
    }

    stake(amount: number): Promise<void> {
        return this.call("stake", { "amount": ntoy(amount) })
    }


    compute_current_unstaking_delay(amount: number): Promise<number> { //returns the number of epochs to wait
        return this.view("compute_current_unstaking_delay", { "amount": ntoy(amount) })
    }

    unstake(amount: number): Promise<void> {
        return this.call("unstake", { "amount": ntoy(amount) })
    }

    unstake_all(): Promise<void> {
        return this.call("unstake_all", {})
    }

    //withdraw_unstaked if waiting period has ended and there are funds retrieved
    withdraw_unstaked(): Promise<void> {
        return this.call("withdraw_unstaked", {})
    }

    //buy stunc/stake
    buy_stunc_stake(amount: number): Promise<void> {
        return this.call("buy_stunc_stake", { "amount": ntoy(amount) })
    }

    //return potential NEARs to receive
    get_unc_amount_sell_stunc(stuncToSell: number): Promise<U128String> {
        return this.view("get_unc_amount_sell_stunc", { "stunc_to_sell": ntoy(stuncToSell) })
    }

    //sell stunc & return NEARs received
    liquid_unstake(stuncToBurn: number, minExpectedNear: number): Promise<LiquidUnstakeResult> {
        return this.call("liquid_unstake", { "st_unc_to_burn": ntoy(stuncToBurn), "min_expected_unc": ntoy(minExpectedNear) }, TGas(75)) //1 yocto hack
    }

    //current fee for liquidity providers
    nslp_get_discount_basis_points(stuncToSell: number): Promise<number> {
        return this.view("nslp_get_discount_basis_points", { "stunc_to_sell": ntoy(stuncToSell) })
    }

    //add liquidity
    nslp_add_liquidity(amount: number): Promise<number> {
        return this.call("nslp_add_liquidity", {}, TGas(75), ntoy(amount))
    }

    //remove liquidity
    nslp_remove_liquidity(amount: number): Promise<RemoveLiquidityResult> {
        return this.call("nslp_remove_liquidity", { "amount": ntoy(amount) }, TGas(100)) //1 yocto hack
    }

    //--------------
    //VLOAN REQUESTS
    //--------------
    get_vloan_request(account_id: string): Promise<VLoanInfo> {
        return this.view("get_vloan_request", { account_id: account_id })
    }

    set_vloan_request(amount_requested: number, staking_pool_account_id: string,
        committed_fee: number, committed_fee_duration: number,
        information_url: String): Promise<void> {
        return this.call("set_vloan_request", {
            amount_requested: ntoy(amount_requested),
            staking_pool_account_id: staking_pool_account_id,
            committed_fee: committed_fee * 100,  //send in basis points
            committed_fee_duration: committed_fee_duration,
            information_url: information_url
        });
    }

    vloan_activate(feeNears: number): Promise<void> {
        return this.call("vloan_activate", {}, TGas(25), ntoy(feeNears))
    }
    vloan_convert_back_to_draft(): Promise<void> {
        return this.call("vloan_convert_back_to_draft", {})
    }
    vloan_take(): Promise<void> {
        return this.call("vloan_take", {})
    }
    vloan_delete(): Promise<void> {
        return this.call("vloan_delete", {})
    }

}

