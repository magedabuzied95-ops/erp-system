export const runRequiredPurchaseAccounting = async (client, operation) => {
  await client.query("SAVEPOINT purchase_accounting_entry");
  try {
    const result = await operation();
    await client.query("RELEASE SAVEPOINT purchase_accounting_entry");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT purchase_accounting_entry").catch(() => {});
    throw error;
  }
};
