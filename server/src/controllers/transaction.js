const { user, transaction, product, profile } = require("../../models");

// Import midtransClient here ...
const midtransClient = require('midtrans-client')

exports.getTransactions = async (req, res) => {
  try {
    const idBuyer = req.user.id;
    let data = await transaction.findAll({
      where: {
        idBuyer,
      },
      order: [["createdAt", "DESC"]],
      attributes: {
        exclude: ["updatedAt", "idBuyer", "idSeller", "idProduct"],
      },
      include: [
        {
          model: product,
          as: "product",
          attributes: {
            exclude: [
              "createdAt",
              "updatedAt",
              "idUser",
              "qty",
              "price",
              "desc",
            ],
          },
        },
        {
          model: user,
          as: "buyer",
          attributes: {
            exclude: ["createdAt", "updatedAt", "password", "status"],
          },
        },
        {
          model: user,
          as: "seller",
          attributes: {
            exclude: ["createdAt", "updatedAt", "password", "status"],
          },
        },
      ],
    });

    data = JSON.parse(JSON.stringify(data));

    data = data.map((item) => {
      return {
        ...item,
        product: {
          ...item.product,
          image: process.env.PATH_FILE + item.product.image,
        },
      };
    });

    res.send({
      status: "success",
      data,
    });
  } catch (error) {
    console.log(error);
    res.send({
      status: "failed",
      message: "Server Error",
    });
  }
};

exports.addTransaction = async (req, res) => {
  try {
    // Prepare transaction data from body here ...
    let data = {
      id: parseInt(req.body.idProduct + Math.random().toString().slice(3,8)),
      ...req.body,
      idBuyer: req.user.id,
      status: 'pending'
    }

    // Insert transaction data here ...
    const newData = await transaction.create(data);

    // Get buyer data here ...
    const buyerData = await user.findOne({
      include: {
        model: profile,
        as: 'profile',
        attributes: {
          exclude: ['createdAt', 'updatedAt', 'idUser']
        }
      },
      where: {
        id: newData.idBuyer
      },
      attributes: {
          exclude: ['createdAt', 'updatedAt', 'password']
        }
    })

    // Create Snap API instance here ...
    let snap = new midtransClient.Snap({
      isProduction: process.env.NODE_ENV && process.env.NODE_ENV !== 'development',
      serverKey: process.env.MIDTRANS_SERVER_KEY
    })

    // Create parameter for Snap API here ...
    let parameter = {
        "transaction_details": {
            "order_id": newData.id,
            "gross_amount": newData.price
        },
        "credit_card":{
            "secure" : true
        },
        "customer_details": {
            "first_name": buyerData.name,
            "last_name": "",
            "email": buyerData.email,
            "phone": buyerData?.profile?.phone
        }
    };

    // Create trasaction token & redirect_url with snap variable here ...
    const payment = await snap.createTransaction(parameter)
    console.log(payment)
    res.send({ 
      status: "pending",
      message: "Pending transaction payment gateway",
      payment,
      product: {
        id: data.idProduct,
      },
    });
  } catch (error) {
    console.log(error);
    res.send({
      status: "failed",
      message: "Server Error",
    });
  }
};

// Create configurate midtrans client with CoreApi here ...
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY

const core = new midtransClient.CoreApi()

core.apiConfig.set({
  idProduction: process.env.NODE_ENV && process.env.NODE_ENV !== 'development',
  serverKey: MIDTRANS_SERVER_KEY,
  clientKey : MIDTRANS_CLIENT_KEY
})

/**
 *  Handle update transaction status after notification
 * from midtrans webhook
 * @param {string} status
 * @param {transactionId} transactionId
 */

// Create function for handle https notification / WebHooks of payment status here ...
exports.notification = async (req, res) => {
  try {
    const notificationResponse = await core.transaction.notification(req.body)
    const orderId = notificationResponse.order_id
    const transactionStatus = notificationResponse.transaction_status
    const fraudStatus = notificationResponse.fraud_status

    console.log(notificationResponse)
    if (transactionStatus == 'capture'){
      if (fraudStatus == 'challenge'){
        // TODO set transaction status on your database to 'challenge'
        await updateTransactionStatus(orderId, 'pending')
        // and response with 200 OK
        res.status(200).send('pending')
      } else if (fraudStatus == 'accept'){
          // TODO set transaction status on your database to 'success'
          await updateTransactionStatus(orderId, 'success')
          // and response with 200 OK
          res.status(200).send('success')
      }
    } else if (transactionStatus == 'settlement'){
        // TODO set transaction status on your database to 'success'
        await updateTransactionStatus(orderId, 'success')
        // and response with 200 OK
        res.status(200).send('success')
    } else if (transactionStatus == 'cancel' ||
      transactionStatus == 'deny' ||
      transactionStatus == 'expire'){
        // TODO set transaction status on your database to 'success'
        await updateTransactionStatus(orderId, 'failure')
        // and response with 200 OK
        res.status(200).send('success')
    } else if (transactionStatus == 'pending'){
       // TODO set transaction status on your database to 'challenge'
      updateTransactionStatus(orderId, 'pending')
      // and response with 200 OK
      res.status(200).send('pending')
    }
  } catch(err) {
    res.status(500).send('error')
  }
}

// Create function for handle transaction update status here ...
const updateTransactionStatus = async (transactionId, status) => {
  await transaction.update({
    status
  }, {
    where: {
      id: transactionId
    }
  })
}

// Create function for handle product update stock/qty here ...
