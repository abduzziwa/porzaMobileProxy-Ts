import express from "express";
import { dataCollector } from "../controllers/dataController.js";
import { homeController } from "../controllers/homeController.js";
import { getCarDetails } from "../controllers/getCarDetails.js";
import { subCatController } from "../controllers/subCatController.js";
import { searchCarByPlate } from "../controllers/searchCarByPlate.js";
import { getCarBrands } from "../controllers/getCarBrands.js";
import { getProducts } from "../controllers/getProducts.js";
import { getModels } from "../controllers/getModels.js";
import { removeCar } from "../controllers/removeCar.js";
import { getVersions } from "../controllers/getVersions.js";
import { setCar } from "../controllers/setCar.js";
import { getCart } from "../controllers/getCart.js";
import { addProductToCart } from "../controllers/addProductToCart.js";
import { increaseDecrease } from "../controllers/increaseDecrease.js";
import { cartDelete } from "../controllers/cartDelete.js";
import { Login } from "../controllers/login.js";
import { Logout } from "../controllers/logout.js";
import { billingInformation } from "../controllers/billingInformation.js";
import { confirmBillingInformation } from "../controllers/confirmBillingInformation.js";
import { paymentLink } from "../controllers/paymentLink.js";
import { getProductsDetails } from "../controllers/getProductDetails.js";
import { getBrandsList } from "../controllers/getBrandsList.js";
import { getFittingList } from "../controllers/getFittingList.js";
import { getOrders } from "../controllers/getOrders.js";
import { getOrderDetails } from "../controllers/getOrderDetails.js";
import { getHelpDeskCode } from "../controllers/getHelpDeskCode.js";
import { getsearchResults } from "../controllers/getSearchResults.js";
import { toggleFilter } from "../controllers/toggleFilter.js";
import { resetFilters } from "../controllers/resetFiltes.js";
import { silentReAuth } from "../middleware/silentReAuth.js";
import { getProductById } from "../controllers/getProductById.js";
import { createOrder } from "../controllers/createOrder.js";
import { getCartV2 } from "../controllers/getCartV2.js";
import {
  addProduct,
  cartDeleteV2,
  decrementProductHandler,
  processCart,
  updateProduct,
} from "../controllers/cartV2.js";
import {
  selectCar,
  removeSelectedCar,
  getSelectedCar,
} from "../controllers/selectCar.js";

const router = express.Router();

router.post("/v1", dataCollector);
router.post("/v1/home", homeController);
router.post("/v1/home/subcategory", subCatController);
router.post("/v1/home/cardetails", getCarDetails);
router.post("/v1/home/selectCar", searchCarByPlate);
router.post("/v1/home/getbrands", getCarBrands);
router.post("/v1/home/getProducts", getProducts);
router.post("/v1/home/getProductDetails", getProductsDetails);
router.post("/v1/home/getProductById", getProductById);
router.post("/v1/home/getModels", getModels);
router.post("/v1/home/removeCar", removeCar);
router.post("/v1/home/getVersions", getVersions);
router.post("/v1/home/setCar", setCar);
router.post("/v1/cart/getCart", getCart);
router.post("/v1/cart/addProduct", addProductToCart);
router.post("/v1/cart/increaseDecrease", increaseDecrease);
router.post("/v1/cart/cartDelete", cartDelete);
router.post("/v1/account/login", Login);
router.post("/v1/account/logout", Logout);
router.post("/v1/account/step2", silentReAuth, billingInformation);
router.post("/v1/account/step3", confirmBillingInformation);
router.post("/v1/account/step4", paymentLink);
router.post("/v1/home/getbrandsList", getBrandsList);
router.post("/v1/home/getfittingList", getFittingList);
router.post("/v1/home/getHelpDeskCode", getHelpDeskCode);
router.post("/v1/account/getOrders", getOrders);
router.post("/v1/account/getOrderDetails", getOrderDetails);
router.post("/v1/home/getSearchResults", getsearchResults);
router.post("/v1/home/toggleFilter", toggleFilter);
router.post("/v1/home/resetFilters", resetFilters);
router.post("/v1/account/createOrder", createOrder);

// v2 cart
router.post("/v2/cart/getCart", getCartV2);
router.post("/v2/cart/addProduct", addProduct);
router.post("/v2/cart/cartDelete", cartDeleteV2);
router.post("/v2/cart/updateProduct", updateProduct);
router.post("/v2/cart/decrementProduct", decrementProductHandler);
router.post("/v2/cart/processCart", processCart);

// v2 car — single endpoint replaces old selectCar + getCarDetails flow
router.post("/v2/car/select", selectCar);
router.post("/v2/car/remove", removeSelectedCar);
router.post("/v2/car/get", getSelectedCar);
export default router;
