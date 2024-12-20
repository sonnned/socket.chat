const cors = require('cors')
const nodemailer = require('nodemailer');
const {
  Server
} = require('http')
const express = require('express')
const { PrismaClient } = require('@prisma/client')
const { PrismaLibSQL } = require('@prisma/adapter-libsql')
const { createClient } = require('@libsql/client')
const dotenv = require('dotenv')
const cookieParser = require('cookie-parser')
const axios = require('axios')
const paypal = require("@paypal/checkout-server-sdk")
const { Queue, Worker } = require('bullmq')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const { v4: uuidv4 } = require('uuid');

dotenv.config()
const port = process.env.PORT || 3000

const libsql = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

const adapter = new PrismaLibSQL(libsql);
const prisma = new PrismaClient({ adapter })

// const environment = new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
const environment = new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)

const paypalClient = new paypal.core.PayPalHttpClient(environment);

const app = express()

app.use(cors({
  origin: "*",
  credentials: true
}))
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


app.use(cookieParser())
app.use(function(req, res, next) {

  const allowedOrigins =  "*";
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept", "Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

app.use((err, req, res, next) => {
  if (err.code === "ECONNRESET") {
    console.error('Connection reset error', err);
    res.status(500).send('Connection was reset, please try again.');
  } else {
    next(err)
  }
})

const server = Server(app)

app.all('*', function(req, res, next) {
  var start = process.hrtime();

  // event triggers when express is done sending response
  res.on('finish', function() {
    var hrtime = process.hrtime(start);
    var elapsed = parseFloat(hrtime[0] + (hrtime[1] / 1000000).toFixed(3), 10);
    console.log(elapsed + 'ms');
  });

  next();
});

app.get('/purchase/:id', async (req, res) => {
  const { id } = req.params
  try {
    const purchase = await prisma.purchase.findUnique({
      where: {
        id
      }
    })

    if (purchase) {
      return res.status(200).json({
        data: purchase,
        message: 'Purchase fetched successfully',
        success: true
      })
    } else {
      return res.status(404).json({
        error: 'Purchase not found'
      })
    }
  } catch (error) {
    console.log('Error from Purchase/:id', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post("/createPurchase", async (req, res) => {
  const {
    purchaseType,
    vin,
    color,
    email,
    state,
    name,
    lastName,
    address,
    city,
    houseType,
    zip,
    phone,
    driverLicense,
    details,
    paypalPaymentId,
    hasFee,
    isInsurance,
    total,
    optionSelectedPlate,
    optionSelectedInsurance,
    insurancePrice,
    insuranceProvider,
    vehicleInsurance,
    image,
    vehicleType,
    saleBill
  } = req.body

  // console.log('req.body', req.body)

  try {
    // console.log('req.body', req.body)
    if (state && !isInsurance) {
      if (!vehicleInsurance && !insuranceProvider) {
        return res.status(400).json({
          error: 'Missing vehicle insurance or insurance provider'
        });
      }
    }
    
    if (vehicleType.includes('Trailer') && !saleBill) {
      return res.status(400).json({
        error: 'Missing sales bill'
      });
    }

    const purchase = await prisma.purchase.create({
      data: {
        purchaseType: purchaseType || "plate",
        vin,
        color,
        email,
        state,
        name,
        lastName,
        address,
        city,
        houseType,
        zip,
        phone,
        driverLicense,
        details,
        paypalPaymentId,
        hasFee,
        isInsurance,
        total,
        optionSelectedPlate,
        optionSelectedInsurance,
        insurancePrice,
        insuranceProvider,
        image,
        vehicleInsurance,
        vehicleType,
        saleBill
      }
    })

    res.status(201).json({
      data: purchase,
      message: 'Purchase created successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from createPurchase', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create order endpoint
app.post('/create-order', async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: amount } }],
    });

    const order = await paypalClient.execute(request);
    res.status(200).json({ id: order.result.id });
  } catch (error) {
    console.error('Error creating PayPal order:', error);
    res.status(500).json({ error: 'Error creating PayPal order' });
  }
});

// Capture order endpoint
app.post('/capture-order', async (req, res) => {
  try {
    const { orderId, purchaseType,
      vin,
      color,
      email,
      state,
      name,
      lastName,
      address,
      city,
      houseType,
      zip,
      phone,
      driverLicense,
      details,
      hasFee,
      isInsurance,
      total,
      optionSelectedPlate,
      optionSelectedInsurance,
      insurancePrice,
      insuranceProvider,
      image,
      vehicleInsurance,
      vehicleType,
      saleBill, } = req.body;

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    // Imprimir la respuesta completa de PayPal
    // console.log('Capture response:', JSON.stringify(capture.result, null, 2));

    const purchaseUnit = capture.result?.purchase_units?.[0];
    const amount = purchaseUnit.payments.captures[0].amount.value

    // console.log('Capture amount:', amount,);
    // console.log('Capture status:', capture);

    if (!amount) {
      return res.status(400).json({ error: 'Payment information is incomplete or missing' });
    }

    if (capture.result.status === 'COMPLETED') {
      const additionalData = {
        purchaseType,
        vin,
        color,
        email,
        state,
        name,
        lastName,
        address,
        city,
        houseType,
        zip,
        phone,
        driverLicense,
        details,
        hasFee,
        isInsurance,
        total,
        optionSelectedPlate,
        optionSelectedInsurance,
        insurancePrice,
        insuranceProvider,
        image,
        vehicleInsurance,
        vehicleType,
        saleBill,
        dateSS
      }
      
      await sendEmail(email, amount, additionalData);
      return res.status(200).json({ message: 'Payment completed and email sent' });
    } else {
      return res.status(400).json({ error: 'Payment not completed' });
    }
  } catch (error) {
    console.error('Error capturing PayPal order:', error.message);
    res.status(500).json({ error: 'Error capturing PayPal order' });
  }
});

// Email sending function
async function sendEmail(email, amount, additionalData) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Detalles de la Compra</title>
      <style>
          body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              margin: 0;
              padding: 20px;
              background-color: #f4f4f4;
          }
          .container {
              background-color: #ffffff;
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
              max-width: 600px;
              margin: 0 auto;
          }
          h1 {
              color: #800080;
              text-align: center;
              margin-bottom: 20px;
          }
          h2, h3 {
              color: #333333;
          }
          p {
              color: #555555;
              margin: 8px 0;
          }
          .section {
              margin-bottom: 20px;
          }
          img {
              max-width: 100%;
              height: auto;
              border: 1px solid #dddddd;
              border-radius: 4px;
              margin-bottom: 10px;
          }
          a {
              color: #007BFF;
              text-decoration: none;
          }
          a:hover {
              text-decoration: underline;
          }
          .footer {
              margin-top: 20px;
              text-align: center;
              color: #777777;
              font-size: 0.9em;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <h2>Detalles de la Compra</h2>
          <div class="section">
              <p><strong>Purchase ID:</strong> ${additionalData.purchaseId || "N/A"}</p>
              <p><strong>Detalles:</strong> ${additionalData.details || "N/A"}</p>
          </div>
          <div class="section">
              <h3>Información Personal</h3>
              <p><strong>Nombre:</strong> ${additionalData.name}</p>
              <p><strong>Apellido:</strong> ${additionalData.lastName}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Estado:</strong> ${additionalData.state}</p>
          </div>
          <div class="section">
              <h3>Información del Vehículo</h3>
              <p><strong>VIN:</strong> ${additionalData.vin}</p>
              <p><strong>Color:</strong> ${additionalData.color}</p>
          </div>
          <div class="section">
              <h3>Dirección</h3>
              <p><strong>Dirección:</strong> ${additionalData.address}</p>
              <p><strong>Ciudad:</strong> ${additionalData.city}</p>
              <p><strong>Tipo de Vivienda:</strong> ${additionalData.houseType}</p>
              <p><strong>Tipo de Vehículo:</strong> ${additionalData.vehicleType}</p>
              <p><strong>Código Postal:</strong> ${additionalData.zip}</p>
          </div>
          <div class="section">
              <h3>Contacto</h3>
              <p><strong>Teléfono:</strong> ${additionalData.phone}</p>
          </div>
          <div class="section">
              <h3>Licencia de Conducir</h3>
              <img src="${additionalData.driverLicense}" alt="Foto de la Licencia de Conducir">
              <p><a href="${additionalData.driverLicense}" target="_blank">Ver Licencia de Conducir</a></p>
          </div>
          <div class="section">
              <h3>Seguro del Vehículo</h3>
              <p><strong>Seguro Proveedor:</strong> ${additionalData.insuranceProvider}</p>
          </div>
          <div class="footer">
              <small>
                  <a href="usatag.us" target="_blank">usatag.us</a>
              </small>
          </div>
      </div>
  </body>
  </html>
    `;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 'usatagsus@gmail.com',
    subject: additionalData.dateSS,
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

app.get('/env', async (req, res) => {
  try {
    const env = process.env
    res.status(200).json({
      data: {
        viteServerURL: process.env.SERVER_URL,
        viteCloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
        viteCloudinaryPreset: process.env.CLOUDINARY_CLOUD_PRESET,
        viteRapidAPIKey: process.env.RAPID_API_KEY,
        viteRapidAPIHost: process.env.RAPID_API_HOST,
        viteRapidAPIBaseURL: process.env.RAPID_API_URL,
        vitePayPalClientID: process.env.PAYPAL_CLIENT_ID,
      },
      message: 'Environment variables fetched successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from env', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/updatePurchase', async (req, res) => {
  try {
    const { purchaseID, paypalPaymentId, pFrom } = req.body;

    // Find the purchase by ID
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseID },
    });

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    await queue.add('complete-update', { purchaseID, paypalPaymentId, pFrom, purchase });
    console.log('Job added to the queue');

    res.status(200).json({
      // data: updatePurchase,
      data: 'Job added to the queue',
      message: 'Purchase updated successfully',
      success: true
    });
  } catch (error) {
    console.error('Error from updatePurchase', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post("/codes/login", async (req, res) => {
  const { email, password } = req.body
  try {
    const user = await prisma.user.findUnique({
      where: {
        email
      }
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const validPassword = await bcrypt.compare(password, user.password)

    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid password' })
    }

    const token = jwt.sign({ email, name: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' })

    return res.status(200).json({
      data: token,
      message: 'User logged in successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from codes/login', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post("/codes/verify", async (req, res) => {
  const { token } = req.body
  try {
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(200).json({
          data: false,
          message: 'Invalid token',
          success: false
        })
      }

      return res.status(200).json({
        data: true,
        message: 'Token verified successfully',
        success: true
      })
    })
  } catch (error) {
    console.log('Error from codes/verify', error)
    res.status(500).json({ error: 'Internal server error' })
  }
});

app.post("/codes/list" , async (req, res) => {
  const { token } = req.body
  try {
    const validToken = jwt.verify(token, process.env.JWT_SECRET)

    if (!validToken) {
      return res.status(400).json({ error: 'Invalid token' })
    }

    const codes = await prisma.plateDetailsCodes.findMany()

    return res.status(200).json({
      data: codes,
      message: 'Codes fetched successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from codes/list', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post("/codes/delete", async (req, res) => {
  const { token, id } = req.body
  try {
    const validToken = jwt.verify(token, process.env.JWT_SECRET)

    if (!validToken) {
      return res.status(400).json({ error: 'Invalid token' })
    }

    const code = await prisma.plateDetailsCodes.findUnique({
      where: {
        id
      }
    })

    if (!code) {
      return res.status(404).json({ error: 'Code not found' })
    }

    await prisma.plateDetailsCodes.delete({
      where: {
        id
      }
    })

    return res.status(200).json({
      data: true,
      message: 'Code deleted successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from codes/delete', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post("/codes/update", async (req, res) => {
  const { token, id, data } = req.body
  console.log('data', data)
  try {
    const validToken = jwt.verify(token, process.env.JWT_SECRET)

    if (!validToken) {
      return res.status(400).json({ error: 'Invalid token' })
    }

    const code = await prisma.plateDetailsCodes.findUnique({
      where: {
        id
      }
    })

    if (!code) {
      return res.status(404).json({ error: 'Code not found' })
    }

    await prisma.plateDetailsCodes.update({
      where: {
        id
      },
      data: {
        ...data,
      }
    })

    return res.status(200).json({
      data: true,
      message: 'Code updated successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from codes/update', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/createPlateCode', async (req, res) => {
  try {
    const {
      tagName,
      status,
      tagIssueDate,
      tagExpirationDate,
      purchasedOrLeased,
      customerType,
      transferPlate,
      vin,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      vehicleBodyStyle,
      tagType,
      vehicleColor,
      vehicleGVW,
      dealerLicenseNumber,
      dealerName,
      dealerAddress,
      dealerPhone,
      dealerType,
      hasBarcode,
      hasQRCode,
      state,
      insuranceProvider,
      isInsurance,
      agentName,
      policyNumber,
      nameOwner,
      address,
      isTexas,

      effectiveTimestamp,
      verificationCode,
      createTimestamp,
      endTimestamp,
      statusCode,
      modelYear,
      make,
      dealerGDN,
      dealerDBA,
     } = req.body

    //  console.log('req.body', {
    //   tagName,
    //   tagType,
    //   effectiveTimestamp,
    //   verificationCode,
    //   createTimestamp,
    //   endTimestamp,
    //   statusCode,
    //   vin,
    //   modelYear,
    //   make,
    //   vehicleBodyStyle,
    //   vehicleColor,
    //   dealerGDN,
    //   dealerName,
    //   dealerDBA,
    //   address,
    //   isTexas
    //  })
    //  return res.status(200).json()

    const findPlateByTag = await prisma.plateDetailsCodes.findMany({
      where: {
        tagName
      }
    })

    if (findPlateByTag.length && !isInsurance && isTexas) {
      return res.status(400).json({ error: 'Plate code already exists' })
    }

    if (isTexas) {
      const plateCode = await prisma.plateDetailsCodes.create({
        data: {
          id: uuidv4(),
          tagName,
          status,
          tagIssueDate,
          tagExpirationDate,
          purchasedOrLeased,
          customerType,
          transferPlate,
          vin,
          vehicleYear,
          vehicleMake,
          vehicleModel,
          vehicleBodyStyle,
          vehicleColor,
          vehicleGVW,
          dealerLicenseNumber,
          dealerName,
          dealerAddress,
          tagType,
          dealerPhone,
          dealerType,
          hasBarcode: true,
          hasQRCode: true,
          State: state,
          insuranceProvider: insuranceProvider || '',
          isInsurance: isInsurance || false,
          agentName,
          policyNumber,
          nameOwner,
          address,
          effectiveTimestamp,
          verificationCode,
          createTimestamp,
          endTimestamp,
          statusCode,
          dealerGDN,
          dealerDBA,
        }
      })

      return res.status(201).json({
        data: plateCode,
        message: 'Plate code created successfully',
        success: true
      })
    }

    if (findPlateByTag.length && !isInsurance) {
      return res.status(400).json({ error: 'Plate code already exists' })
    }

    const findByPolicyNumber = await prisma.plateDetailsCodes.findMany({
      where: {
        policyNumber
      }
    })

    if (findByPolicyNumber.length && isInsurance) {
      return res.status(400).json({ error: 'Policy number already exists' })
    }

    const plateCode = await prisma.plateDetailsCodes.create({
      data: {
        id: uuidv4(),
        tagName,
        status,
        tagIssueDate,
        tagExpirationDate,
        purchasedOrLeased,
        customerType,
        transferPlate,
        vin,
        vehicleYear,
        vehicleMake,
        vehicleModel,
        vehicleBodyStyle,
        vehicleColor,
        vehicleGVW,
        dealerLicenseNumber,
        dealerName,
        dealerAddress,
        tagType,
        dealerPhone,
        dealerType,
        hasBarcode: true,
        hasQRCode: true,
        State: state,
        insuranceProvider: insuranceProvider || '',
        isInsurance: isInsurance || false,
        agentName,
        policyNumber,
        nameOwner,
        address
      }
    })

    res.status(201).json({
      data: plateCode,
      message: 'Plate code created successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from createPLateCode', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/plateDetailsCodes', async (req, res) => {
  try {
    const plateDetailsCodes = await prisma.plateDetailsCodes.findMany()

    res.status(200).json({
      data: plateDetailsCodes,
      message: 'QR codes fetched successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from plateDetailsCodes', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})


app.get('/plateDetailsCodes/:tagName', async (req, res) => {
  const { tagName } = req.params
  try {
    const plateDetailsCode = await prisma.plateDetailsCodes.findMany({
      where: {
        tagName
      }
    })

    const vinSeach = await prisma.plateDetailsCodes.findMany({
      where: {
        vin: tagName
      }
    })

    const policyNumberSearch = await prisma.plateDetailsCodes.findMany({
      where: {
        policyNumber: tagName
      }
    })

    plateDetailsCode.push(...vinSeach)
    plateDetailsCode.push(...policyNumberSearch)

    if (!plateDetailsCode) {
      return res.status(404).json({ error: 'Plate code not found' })
    }

    res.status(200).json({
      data: plateDetailsCode[0],
      message: 'Plate code fetched successfully',
      success: true
    })
  } catch (error) {
    console.log('Error from plateDetailsCodes/:tagName', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

server.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})

server.timeout = 300000