import type {
  Actions,
  AddEthereumChainParameter,
  Provider,
  ProviderConnectInfo,
  ProviderRpcError,
  // WatchAssetParameters,
} from '@web3-react/types'
import { Connector } from '@web3-react/types'

type ClvWalletProvider = Provider & { isClover?: boolean; providers?: ClvWalletProvider[] }

export class NoClvWalletError extends Error {
  public constructor() {
    super('Clv wallet not installed')
    this.name = NoClvWalletError.name
    Object.setPrototypeOf(this, NoClvWalletError.prototype)
  }
}

function parseChainId(chainId: string) {
  return Number.parseInt(chainId, 16)
}

/**
 * @param options - Options to pass to `@metamask/detect-provider`
 * @param onError - Handler to report errors thrown from eventListeners.
 */
export interface ClvWalletConstructorArgs {
  actions: Actions
}

export class ClvWallet extends Connector {
  /** {@inheritdoc Connector.provider} */
  public provider?: ClvWalletProvider

  private eagerConnection?: Promise<void>

  constructor({ actions }: ClvWalletConstructorArgs) {
    super(actions)
  }

  private detectProvide() {
    return new Promise(resolve => {
      if (window.clover) {
        resolve(window.clover)
      } else {
        setTimeout(() => {
          resolve(window.clover)
        }, 3000)
      }
    })
  }
  private async isomorphicInitialize(): Promise<void> {
    if (this.eagerConnection) return

    return (this.eagerConnection = this.detectProvide().then(async (m) => {
      const provider = m
      if (provider) {
        this.provider = provider as ClvWalletProvider

        // handle the case when e.g. metamask and coinbase wallet are both installed
        if (this.provider.providers?.length) {
          this.provider = this.provider.providers.find((p: any) => p.isClover) ?? this.provider.providers[0]
        }

        this.provider.on('connect', ({ chainId }: ProviderConnectInfo): void => {
          this.actions.update({ chainId: parseChainId(chainId) })
        })

        this.provider.on('disconnect', (error: ProviderRpcError): void => {
          this.actions.resetState()
          this.onError?.(error)
        })

        this.provider.on('chainChanged', (chainId: string): void => {
          this.actions.update({ chainId: parseChainId(chainId) })
        })

        this.provider.on('accountsChanged', (accounts: string[]): void => {
          if (accounts.length === 0) {
            // handle this edge case by disconnecting
            this.actions.resetState()
          } else {
            this.actions.update({ accounts })
          }
        })
      }
    }))
  }

  /** {@inheritdoc Connector.connectEagerly} */
  public async connectEagerly(): Promise<void> {
    const cancelActivation = this.actions.startActivation()

    await this.isomorphicInitialize()
    if (!this.provider) return cancelActivation()

    return Promise.all([
      this.provider.request({ method: 'eth_chainId' }) as Promise<string>,
      this.provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
    ])
      .then(([chainId, accounts]) => {
        if (accounts.length) {
          this.actions.update({ chainId: parseChainId(chainId), accounts })
        } else {
          throw new Error('No accounts returned')
        }
      })
      .catch((error) => {
        console.debug('Could not connect eagerly', error)
        // we should be able to use `cancelActivation` here, but on mobile, metamask emits a 'connect'
        // event, meaning that chainId is updated, and cancelActivation doesn't work because an intermediary
        // update has occurred, so we reset state instead
        this.actions.resetState()
      })
  }

  /**
   * Initiates a connection.
   *
   * @param desiredChainIdOrChainParameters - If defined, indicates the desired chain to connect to. If the user is
   * already connected to this chain, no additional steps will be taken. Otherwise, the user will be prompted to switch
   * to the chain, if one of two conditions is met: either they already have it added in their extension, or the
   * argument is of type AddEthereumChainParameter, in which case the user will be prompted to add the chain with the
   * specified parameters first, before being prompted to switch.
   */
  public async activate(desiredChainIdOrChainParameters?: number | AddEthereumChainParameter): Promise<void> {
    // let cancelActivation: () => void
    // if (!this.provider?.isConnected?.()) cancelActivation = this.actions.startActivation()

    return this.isomorphicInitialize()
      .then(async () => {
        if (!this.provider) throw new NoClvWalletError()

        return Promise.all([
          this.provider.request({ method: 'eth_chainId' }) as Promise<string>,
          this.provider.request({ method: 'eth_requestAccounts' }) as Promise<string[]>,
        ]).then(([chainId, accounts]) => {
          const receivedChainId = parseChainId(chainId)
          const desiredChainId =
            typeof desiredChainIdOrChainParameters === 'number'
              ? desiredChainIdOrChainParameters
              : desiredChainIdOrChainParameters?.chainId

          // if there's no desired chain, or it's equal to the received, update
          if (!desiredChainId || receivedChainId === desiredChainId)
            return this.actions.update({ chainId: receivedChainId, accounts })

          const desiredChainIdHex = `0x${desiredChainId.toString(16)}`

          // if we're here, we can try to switch networks
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          return this.provider!.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: desiredChainIdHex }],
          })
            .catch((error: ProviderRpcError) => {
              if (error.code === 4902 && typeof desiredChainIdOrChainParameters !== 'number') {
                // if we're here, we can try to add a new network
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                return this.provider!.request({
                  method: 'wallet_addEthereumChain',
                  params: [{ ...desiredChainIdOrChainParameters, chainId: desiredChainIdHex }],
                })
              }

              throw error
            })
            .then(() => this.activate(desiredChainId))
        })
      })
      .catch((error) => {
        // cancelActivation?.()
        throw error
      })
  }

  // public async watchAsset({ address, symbol, decimals, image }: WatchAssetParameters): Promise<true> {
  //   if (!this.provider) throw new Error('No provider')

  //   return this.provider
  //     .request({
  //       method: 'wallet_watchAsset',
  //       params: {
  //         type: 'ERC20', // Initially only supports ERC20, but eventually more!
  //         options: {
  //           address, // The address that the token is at.
  //           symbol, // A ticker symbol or shorthand, up to 5 chars.
  //           decimals, // The number of decimals in the token
  //           image, // A string url of the token logo
  //         },
  //       },
  //     })
  //     .then((success) => {
  //       if (!success) throw new Error('Rejected')
  //       return true
  //     })
  // }
}
