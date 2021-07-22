import { AbstractConnectorArguments, ConnectorUpdate } from "@web3-react/types";
import { AbstractConnector } from "@web3-react/abstract-connector";
import warning from "tiny-warning";

import { SendReturnResult, SendReturn, Send, SendOld } from "./types";

function parseSendReturn(sendReturn: SendReturnResult | SendReturn): any {
  return sendReturn.hasOwnProperty("result") ? sendReturn.result : sendReturn;
}

export class NoCloverProviderError extends Error {
  public constructor() {
    super();
    this.name = this.constructor.name;
    this.message = "No Clover provider was found on window.clover.";
  }
}

export class UserRejectedRequestError extends Error {
  public constructor() {
    super();
    this.name = this.constructor.name;
    this.message = "The user rejected the request.";
  }
}

export class CloverConnector extends AbstractConnector {
  constructor(kwargs: AbstractConnectorArguments) {
    super(kwargs);

    this.handleNetworkChanged = this.handleNetworkChanged.bind(this);
    this.handleChainChanged = this.handleChainChanged.bind(this);
    this.handleAccountsChanged = this.handleAccountsChanged.bind(this);
    this.handleClose = this.handleClose.bind(this);
  }

  private handleChainChanged(chainId: string | number): void {
    if (__DEV__) {
      console.log("Handling 'chainChanged' event with payload", chainId);
    }
    this.emitUpdate({ chainId, provider: window.clover });
  }

  private handleAccountsChanged(accounts: string[]): void {
    if (__DEV__) {
      console.log("Handling 'accountsChanged' event with payload", accounts);
    }
    if (accounts.length === 0) {
      this.emitDeactivate();
    } else {
      this.emitUpdate({ account: accounts[0] });
    }
  }

  private handleClose(code: number, reason: string): void {
    if (__DEV__) {
      console.log("Handling 'close' event with payload", code, reason);
    }
    this.emitDeactivate();
  }

  private handleNetworkChanged(networkId: string | number): void {
    if (__DEV__) {
      console.log("Handling 'networkChanged' event with payload", networkId);
    }
    this.emitUpdate({ chainId: networkId, provider: window.clover });
  }

  public async activate(): Promise<ConnectorUpdate> {
    if (!window.clover) {
      throw new NoCloverProviderError();
    }

    if (window.clover.on) {
      window.clover.on("chainChanged", this.handleChainChanged);
      window.clover.on("accountsChanged", this.handleAccountsChanged);
      window.clover.on("close", this.handleClose);
      window.clover.on("networkChanged", this.handleNetworkChanged);
    }

    if ((window.clover as any).isMetaMask) {
      (window.clover as any).autoRefreshOnNetworkChange = false;
    }

    // try to activate + get account via eth_requestAccounts
    let account;
    try {
      account = await (window.clover.send as Send)(
        "eth_requestAccounts"
      ).then((sendReturn) => parseSendReturn(sendReturn)[0]);
    } catch (error) {
      if ((error as any).code === 4001) {
        throw new UserRejectedRequestError();
      }
      warning(
        false,
        "eth_requestAccounts was unsuccessful, falling back to enable"
      );
    }

    // if unsuccessful, try enable
    if (!account) {
      // if enable is successful but doesn't return accounts, fall back to getAccount (not happy i have to do this...)
      account = await window.clover.enable().then(
        (sendReturn) => sendReturn && parseSendReturn(sendReturn)[0]
      );
    }

    return { provider: window.clover, ...(account ? { account } : {}) };
  }

  public async getProvider(): Promise<any> {
    return window.clover;
  }

  public async getChainId(): Promise<number | string> {
    if (!window.clover) {
      throw new NoCloverProviderError();
    }

    let chainId;
    try {
      chainId = await (window.clover.send as Send)("eth_chainId").then(
        parseSendReturn
      );
    } catch {
      warning(
        false,
        "eth_chainId was unsuccessful, falling back to net_version"
      );
    }

    if (!chainId) {
      try {
        chainId = await (window.clover.send as Send)("net_version").then(
          parseSendReturn
        );
      } catch {
        warning(
          false,
          "net_version was unsuccessful, falling back to net version v2"
        );
      }
    }

    if (!chainId) {
      try {
        chainId = parseSendReturn(
          (window.clover.send as SendOld)({ method: "net_version" })
        );
      } catch {
        warning(
          false,
          "net_version v2 was unsuccessful, falling back to manual matches and static properties"
        );
      }
    }

    if (!chainId) {
      if ((window.clover as any).isDapper) {
        chainId = parseSendReturn(
          (window.clover as any).cachedResults.net_version
        );
      } else {
        chainId =
          (window.clover as any).chainId ||
          (window.clover as any).netVersion ||
          (window.clover as any).networkVersion ||
          (window.clover as any)._chainId;
      }
    }

    return chainId;
  }

  public async getAccount(): Promise<null | string> {
    if (!window.clover) {
      throw new NoCloverProviderError();
    }

    let account;
    try {
      account = await (window.clover.send as Send)("eth_accounts").then(
        (sendReturn) => parseSendReturn(sendReturn)[0]
      );
    } catch {
      warning(false, "eth_accounts was unsuccessful, falling back to enable");
    }

    if (!account) {
      try {
        account = await window.clover.enable().then(
          (sendReturn) => parseSendReturn(sendReturn)[0]
        );
      } catch {
        warning(
          false,
          "enable was unsuccessful, falling back to eth_accounts v2"
        );
      }
    }

    if (!account) {
      account = parseSendReturn(
        (window.clover.send as SendOld)({ method: "eth_accounts" })
      )[0];
    }

    return account;
  }

  public deactivate() {
    if (window.clover && window.clover.removeListener) {
      window.clover.removeListener(
        "chainChanged",
        this.handleChainChanged
      );
      window.clover.removeListener(
        "accountsChanged",
        this.handleAccountsChanged
      );
      window.clover.removeListener("close", this.handleClose);
      window.clover.removeListener(
        "networkChanged",
        this.handleNetworkChanged
      );
    }
  }

  public async isAuthorized(): Promise<boolean> {
    if (!window.clover) {
      return false;
    }

    try {
      return await (window.clover.send as Send)("eth_accounts").then(
        (sendReturn) => {
          if (parseSendReturn(sendReturn).length > 0) {
            return true;
          } else {
            return false;
          }
        }
      );
    } catch {
      return false;
    }
  }
}
