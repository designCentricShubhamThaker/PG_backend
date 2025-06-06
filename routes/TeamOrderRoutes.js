
import express from 'express';
import {
  getAllOrders,
  getOrderById,
  createOrder,
  updateOrder,
  deleteOrder,
  createOrderItem,
  getOrderByNumber
} from '../controllers/orderController.js';

const router = express.Router();

router.route('/')
  .get(getAllOrders)
  .post(createOrder);

  router.route('/number/:orderNumber')
  .get(getOrderByNumber);

router.route('/:id')
  .get(getOrderById)
  .put(updateOrder)
  .delete(deleteOrder);

router.route('/:order_id/items')
  .post(createOrderItem);

export default router;