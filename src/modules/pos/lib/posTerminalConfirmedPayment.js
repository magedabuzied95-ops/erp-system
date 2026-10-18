// The invoice a Paymob terminal approval turns into. In a split sale the machine
// only charges the card part; the cash / wallet parts the cashier entered next
// to it are still collected at the till. They used to be dropped here, so the
// invoice went up as "Paid" with the card amount alone, the server refused it
// as partially paid, and the till showed a failure for a charge the machine had
// already taken (INV-2183: 640 card + 460 cash).
export const buildTerminalConfirmedPayment = ({
  paymentMode = "",
  terminalAmount = 0,
  cashAmount = 0,
  walletAmount = 0,
  vodafoneCashAmount = 0,
  customerWalletAmount = 0,
} = {}) => {
  const split = paymentMode === "split";
  const part = (value) => (split ? Math.max(0, Number(value || 0) || 0) : 0);
  const cash = part(cashAmount);
  const wallet = part(walletAmount);
  const vodafoneCash = part(vodafoneCashAmount);
  const customerWallet = part(customerWalletAmount);
  const card = Math.max(0, Number(terminalAmount || 0) || 0);
  const otherPaid = cash + wallet + vodafoneCash + customerWallet;
  return {
    paymentMethod: otherPaid > 0 ? "split" : "card",
    cash,
    card,
    wallet,
    vodafoneCash,
    customerWallet,
    paidAmount: card + otherPaid,
  };
};
