import express from 'express';
import {
  getAllCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer
} from '../controllers/CustomerController.js';

const router = express.Router();

router.route('/')
  .get(getAllCustomers)
  .post(createCustomer);

router.route('/:id')
  .put(updateCustomer)
  .delete(deleteCustomer);

export default router;
