import express from 'express';
import {
  getAllAccessories, createAccessories, updateAccessories, deleteAccessories
} from '../controllers/accessoriesData.js';

const router = express.Router();

router.route('/')
  .get(getAllAccessories)
  .post(createAccessories);

router.route('/:id')
  .put(updateAccessories)
  .delete(deleteAccessories);

export default router;
