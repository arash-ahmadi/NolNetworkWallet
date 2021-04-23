import { BigNumber } from 'bignumber.js'
import { getState } from 'redux/core'
import actions from 'redux/actions'
import DEFAULT_CURRENCY_PARAMETERS from 'common/helpers/constants/DEFAULT_CURRENCY_PARAMETERS'
import { web3, getWeb3 } from 'helpers/web3'
import externalConfig from 'helpers/externalConfig'
import helpers, { feedback } from 'helpers'

class EthLikeAction {
  private ticker: string // upper case
  private tickerKey: string // lower case
  private ownerAddress: string
  private precision: number // number of digits after the dot
  private explorerLink: string
  private adminFeeObj: {
    feePercent: string // percent of amount
    address: string // where to send
    minAmount: string // min amount
  }

  constructor(options) {
    const {
      ticker,
      precision,
      ownerAddress,
      explorerLink,
      adminFeeObj,
    } = options

    this.ticker = ticker
    this.tickerKey = ticker.toLowerCase()
    this.precision = precision
    this.ownerAddress = ownerAddress
    this.explorerLink = explorerLink
    this.adminFeeObj = adminFeeObj
  }

  reportError = (error) => {
    feedback.actions.failed(`details(ticker: ${this.ticker}); message(${error.message})`)
    console.group(`Actions >%c ${this.ticker}`, 'color: red;')
    console.error('error: ', error)
    console.groupEnd()
  }

  getPrivateKeyByAddress = (address) => {
    const {
      user: {
        [`${this.tickerKey}Data`]: {
          address: oldAddress,
          privateKey,
        },
        [`${this.tickerKey}MnemonicData`]: {
          address: mnemonicAddress,
          privateKey: mnemonicKey,
        },
      },
    } = getState()

    if (oldAddress === address) return privateKey
    if (mnemonicAddress === address) return mnemonicKey
  }

  getInvoices = () => {
    return actions.invoices.getInvoices({
      currency: this.ticker,
      address: this.ownerAddress,
    })
  }
  
  getTx = (txRaw) => {
    return txRaw.transactionHash
  }

  getTxRouter = (txId) => {
    return `/${this.tickerKey}/tx/${txId}`
  }

  getLinkToInfo = (tx) => {
    if (!tx) return
    return `${this.explorerLink}/tx/${tx}`
  }

  fetchBalance = async (): Promise<string> => {
    return web3.eth.getBalance(this.ownerAddress)
      .then(result => Number(web3.utils.fromWei(result)))
      .catch(error => this.reportError(error))
  }

  send = async (params): Promise<string> => {
    let { to, amount, gasPrice, gasLimit, speed } = params
    const web3js = await getWeb3()
    const recipientIsContract = await addressIsContract(to)

    gasPrice = 0 || await helpers[this.tickerKey].estimateGasPrice({ speed })
    gasLimit = gasLimit || (
      recipientIsContract
        // ? will use eth data for all ABBlockchains ?
        ? DEFAULT_CURRENCY_PARAMETERS.eth.limit.contractInteract
        : DEFAULT_CURRENCY_PARAMETERS.eth.limit.send
    )
      
    let sendMethod = web3js.eth.sendTransaction
    let txObject = {
      from: this.ownerAddress,
      to: to.trim(),
      gasPrice,
      gas: gasLimit,
      value: web3.utils.toWei(String(amount)),
    }
    const walletData = actions.core.getWallet({
      address: this.ownerAddress,
      currency: this.ticker,
    })
    const privateKey = this.getPrivateKeyByAddress(this.ownerAddress)

    if (!walletData.isMetamask) {
      const signedTx = await web3js.eth.accounts.signTransaction(txObject, privateKey)
      sendMethod = web3js.eth.sendSignedTransaction
      txObject = signedTx.rawTransaction
    }

    return new Promise((res, rej) => {
      const receipt = sendMethod(txObject)
        // TODO: in this response the hash equals undefined
        .on('transactionHash', (hash) => res(`${this.explorerLink}/tx/${hash}`))
        .on('error', (error) => rej(error))
      // Admin fee transaction
      if (this.adminFeeObj && !walletData.isMetamask) {
        receipt.then(() => {
          this.sendAdminFee({
            amount,
            gasPrice,
            gasLimit,
            privateKey,
          })
        })
      }
    })
  }
  // TODO: check this method
  sendAdminFee = async (params) => {
    const web3js = await getWeb3()
    const { amount, gasPrice, gasLimit, privateKey } = params

    const minAmount = new BigNumber(this.adminFeeObj.minAmount)
    let sendedFeeAmount = new BigNumber(this.adminFeeObj.feePercent)
      .dividedBy(100) // 100 %
      .multipliedBy(amount)
      .toNumber()
    
    if (minAmount.isGreaterThan(sendedFeeAmount)) {
      sendedFeeAmount = minAmount.toNumber()
    }

    const adminFeeParams = {
      to: this.adminFeeObj.address.trim(),
      gasPrice,
      gas: gasLimit,
      value: web3js.utils.toWei(String(sendedFeeAmount)),
    }

    return new Promise(async () => {
      const signedTxObj = await web3js.eth.accounts.signTransaction(adminFeeParams, privateKey)
    
      web3js.eth.sendSignedTransaction(signedTxObj.rawTransaction)
        .on('transactionHash', (hash) => {
          console.group('%c Admin commission is sended', 'color: green;')
          console.log('tx hash', hash)
          console.groupEnd()
        })
    })
  }

  /* 
  login
  getBalance
  getTransaction
  getWalletByWords
  sweepToMnemonic
  isSweeped
  getSweepAddress
  getAllMyAddresses
  fetchTxInfo
  sendTransaction
  addressIsContract
  */
}

// ? move it into common (used only eth, bnb actions)
const _addressIsContractCache = {}

const addressIsContract = async (address: string): Promise<boolean> => {
  const lowerAddress = address.toLowerCase()

  if (_addressIsContractCache[lowerAddress]) {
    return _addressIsContractCache[lowerAddress]
  }

  const codeAtAddress = await web3.eth.getCode(address)
  const codeIsEmpty = !codeAtAddress || codeAtAddress === '0x' || codeAtAddress === '0x0'

  _addressIsContractCache[lowerAddress] = !codeIsEmpty
  return !codeIsEmpty
}

const {
  user: {
    ethData: { address: ethOwnerAddress },
    bnbData: { address: bnbOwnerAddress },
  }
} = getState()

export default {
  ETH: new EthLikeAction({
    ticker: 'ETH',
    precision: 18,
    ownerAddress: ethOwnerAddress,
    explorerLink: externalConfig.link?.etherscan,
    adminFeeObj: externalConfig.opts?.fee?.eth,
  }),
  BNB: new EthLikeAction({
    ticker: 'BNB',
    precision: 18,
    ownerAddress: bnbOwnerAddress,
    explorerLink: externalConfig.link?.bscscan,
    adminFeeObj: externalConfig.opts?.fee?.bnb,
  }),
}