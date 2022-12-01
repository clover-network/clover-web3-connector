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
    this.getCloverProvider = this.getCloverProvider.bind(this)
  }

  private handleChainChanged(chainId: string | number): void {
    if (__DEV__) {
      console.log("Handling 'chainChanged' event with payload", chainId);
    }
    this.emitUpdate({ chainId, provider: this.getCloverProvider() });
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
    this.emitUpdate({ chainId: networkId, provider: this.getCloverProvider() });
  }

  private getCloverProvider() {
    const provider = window.clover as any
    if (provider?.providers?.length) {
      return provider.providers.find((p: any) => p.isClover) ?? provider.providers[0]
    }
    return provider
  }

  public async activate(): Promise<ConnectorUpdate> {
    if (!window.clover) {
      throw new NoCloverProviderError();
    }

    const provider = this.getCloverProvider()
    if (provider.on) {
      provider.on("chainChanged", this.handleChainChanged);
      provider.on("accountsChanged", this.handleAccountsChanged);
      provider.on("close", this.handleClose);
      provider.on("networkChanged", this.handleNetworkChanged);
    }

    if (provider.isClover) {
      provider.autoRefreshOnNetworkChange = false;
    }

    // try to activate + get account via eth_requestAccounts
    let account;
    try {
      account = await (provider.send as Send)(
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
      account = await provider.enable().then(
        (sendReturn: any) => sendReturn && parseSendReturn(sendReturn)[0]
      );
    }

    return { provider: provider, ...(account ? { account } : {}) };
  }

  public async getProvider(): Promise<any> {
    return this.getCloverProvider();
  }

  public async getChainId(): Promise<number | string> {
    if (!window.clover) {
      throw new NoCloverProviderError();
    }

    let chainId;
    const provider = this.getCloverProvider()
    try {
      chainId = await (provider.send as Send)("eth_chainId").then(
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
        chainId = await (provider.send as Send)("net_version").then(
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
          (provider.send as SendOld)({ method: "net_version" })
        );
      } catch {
        warning(
          false,
          "net_version v2 was unsuccessful, falling back to manual matches and static properties"
        );
      }
    }

    if (!chainId) {
      if ((provider as any).isDapper) {
        chainId = parseSendReturn(
          (provider as any).cachedResults.net_version
        );
      } else {
        chainId =
          provider.chainId ||
          provider.netVersion ||
          provider.networkVersion ||
          provider._chainId;
      }
    }

    return chainId;
  }

  public async getAccount(): Promise<null | string> {
    if (!window.clover) {
      throw new NoCloverProviderError();
    }

    let account;
    const provider = this.getCloverProvider()
    try {
      account = await (provider.send as Send)("eth_accounts").then(
        (sendReturn) => parseSendReturn(sendReturn)[0]
      );
    } catch {
      warning(false, "eth_accounts was unsuccessful, falling back to enable");
    }

    if (!account) {
      try {
        account = await provider.enable().then(
          (sendReturn: any) => parseSendReturn(sendReturn)[0]
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
        (provider.send as SendOld)({ method: "eth_accounts" })
      )[0];
    }

    return account;
  }

  public deactivate() {
    const provider = this.getCloverProvider()
    if (provider?.removeListener) {
      provider.removeListener(
        "chainChanged",
        this.handleChainChanged
      );
      provider.removeListener(
        "accountsChanged",
        this.handleAccountsChanged
      );
      provider.removeListener("close", this.handleClose);
      provider.removeListener(
        "networkChanged",
        this.handleNetworkChanged
      );
    }
  }

  public async isAuthorized(): Promise<boolean> {
    if (!window.clover) {
      return false;
    }

    const provider = this.getCloverProvider()
    try {
      return await (provider.send as Send)("eth_accounts").then(
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
