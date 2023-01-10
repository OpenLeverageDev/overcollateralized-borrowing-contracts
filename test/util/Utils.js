exports.toBN = toBN = function (bn) {
    return web3.utils.toBN(bn);
}

exports.toWei = (amount) => {
    return toBN(1e18).mul(toBN(amount));
}

exports.maxUint = () => {
    let max = toBN(2).pow(toBN(256)).sub(toBN(1));
    return max;
}

exports.equalBN = (expected, actual) => {
    assert.equal(expected.toString(), actual.toString());
}
exports.ltBN = (expected, actual) => {
    assert.equal(toBN(expected).lt(toBN(actual)), true);
}
exports.gtBN = (expected, actual) => {
    assert.equal(toBN(expected).gt(toBN(actual)), true);
}